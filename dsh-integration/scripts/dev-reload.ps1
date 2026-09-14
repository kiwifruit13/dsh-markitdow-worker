<#
.SYNOPSIS
    markitdown × DSH 集成 —— 开发循环一键刷新（build + remove + add + verify）。

.DESCRIPTION
    背景（ISSUES.md 问题 3）：`dsh plugin add file:<dir>` 在 pnpm 下是**目录拷贝**，
    所以每次改完源码都必须 (1) 重建 lib (2) 从 profile 移除旧包 (3) 重新 add 新目录。
    手工执行这三步时最容易漏掉第 2 步 —— 同版本的 `file:` 引用会被 pnpm 判定为
    "Already up to date"，导致运行树仍是旧产物（本仓库已实际踩过）。

    本脚本把这三步 + 一次配置合成校验封装为单条命令，幂等可重复执行。

    为什么不用 `dsh --patch <overlay>`（另一条候选路线）：该开关是**逐次调用**的 CLI 参数，
    且只叠加插件条目、不改变模块解析 —— 每次启动都要记得带上，不符合"无需记忆额外步骤"。
    详见 README「开发循环」小节。

.PARAMETER Profile
    DSH profile 名。默认 web。

.PARAMETER Only
    只刷新指定包（目录名，如 dsh-tool-markitdown）。默认按定义包 → 提供者 → 消费者顺序全刷。

.PARAMETER SkipBuild
    跳过 `pnpm run build:lib`（仅重装，用于只改了 yml/package.json 的场景）。

.PARAMETER NoVerify
    跳过末尾的 `dsh --dump-config` 配置合成校验。

.PARAMETER DryRun
    只打印将要执行的命令，不做任何改动。

.PARAMETER AddRetries
    `dsh plugin add` 失败时的重试次数。默认 3。
    为什么需要：Windows 上 pnpm 交换目录（rename tmp -> 目标）偶发 `EPERM` ——
    杀软/索引器短暂持有句柄所致，重试通常即通过（本机已实测触发一次）。

.PARAMETER RetryDelaySec
    重试间隔秒数。默认 2。

.EXAMPLE
    pwsh -File dsh-integration/scripts/dev-reload.ps1 -DryRun
.EXAMPLE
    pwsh -File dsh-integration/scripts/dev-reload.ps1 -Only dsh-tool-markitdown
#>
[CmdletBinding()]
param(
    [string]$Profile = 'web',
    [string[]]$Only,
    [switch]$SkipBuild,
    [switch]$NoVerify,
    [switch]$DryRun,
    [int]$AddRetries = 3,
    [int]$RetryDelaySec = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows 控制台默认编码非 UTF-8 → 透传 pnpm 的 '✓'、dsh 的中文/破折号警告会乱码
# （实测表现为 '鉁?'）。显式设为 UTF-8，保证子进程输出与日志文件可读。
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
}
catch {
    Write-Output 'dev-reload: 无法设置 UTF-8 控制台编码，输出可能出现乱码（不影响执行）'
}

# 定义包 → 提供者 → 消费者：顺序固定（tsc 需先解析定义包类型；profile 装载也按此序）
$AllPackages = @('dsh-markitdown', 'dsh-markitdown-worker', 'dsh-tool-markitdown')
$Scope = '@kiwifruit'

# ---- 0) 定位仓库根（本脚本位于 <root>/dsh-integration/scripts/） ----
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$integrationDir = Split-Path -Parent $scriptDir          # <root>/dsh-integration
$repoRoot = Split-Path -Parent $integrationDir           # <root>
if (-not (Test-Path -LiteralPath (Join-Path $integrationDir 'pnpm-workspace.yaml'))) {
    throw "dev-reload: 未在 '$integrationDir' 找到 pnpm-workspace.yaml —— 脚本位置异常。"
}

# ---- 1) 解析目标包列表，校验目录存在 ----
$targets = if ($Only) { $Only } else { $AllPackages }
foreach ($name in $targets) {
    if ($AllPackages -notcontains $name) {
        throw "dev-reload: 未知包 '$name'。可选：$($AllPackages -join ', ')"
    }
}
$dirs = foreach ($name in $targets) {
    $abs = Join-Path $integrationDir $name
    if (-not (Test-Path -LiteralPath (Join-Path $abs 'package.json'))) {
        throw "dev-reload: 目录或 package.json 缺失 -> $abs"
    }
    $abs
}

Write-Output "dev-reload: repo=$repoRoot profile=$Profile dryRun=$([bool]$DryRun)"
Write-Output "dev-reload: targets=$($targets -join ', ')"

function Invoke-Step {
    param([string]$Label, [string]$Exe, [string[]]$ExeArgs, [string]$WorkingDirectory)
    # 用参数数组 + & 调用，避免注入与引号问题；输出直通宿主
    Write-Output "  -> $Label"
    Write-Output "     $Exe $($ExeArgs -join ' ')"
    if ($DryRun) { return }
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $Exe @ExeArgs
        if ($LASTEXITCODE -ne 0) {
            throw "dev-reload: '$Label' 失败（exit=$LASTEXITCODE）"
        }
    }
    finally {
        Pop-Location
    }
}

# ---- 2) 重建（按顺序） ----
if (-not $SkipBuild) {
    for ($i = 0; $i -lt $targets.Count; $i++) {
        Invoke-Step -Label ("build " + $targets[$i]) -Exe 'pnpm' -ExeArgs @('run', 'build:lib') -WorkingDirectory $dirs[$i]
    }
}
else {
    Write-Output 'dev-reload: 跳过构建（-SkipBuild）'
}

# ---- 3) remove + add（逐包；remove 失败视为"本就未安装"，不中断） ----
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$profilesDir = Join-Path $dshHome 'profiles'
$nodeModules = Join-Path (Join-Path $profilesDir $Profile) 'node_modules'
$scopeDir = Join-Path $nodeModules $Scope

# 预检：非优雅终止（Ctrl+C 之外的方式强杀）会残留 pnpm 写锁，使后续 pnpm/dsh 报
# "atomic-write: timed out waiting for the writer lock"。只提示、不自动删 —— 锁可能仍被活进程持有。
$lockFile = Join-Path $profilesDir 'node_modules.lock'
if (Test-Path -LiteralPath $lockFile) {
    $holder = Get-Content -LiteralPath $lockFile -Raw -ErrorAction SilentlyContinue
    Write-Output "  !! 检测到 profile 写锁：$lockFile"
    if ($holder) { Write-Output "     记录的持有者 PID = $($holder.Trim())" }
    Write-Output '     若该 PID 已不存在 → 先删除该锁文件再重跑；否则 pnpm 可能报 atomic-write 超时。'
}

for ($i = 0; $i -lt $targets.Count; $i++) {
    $pkgRef = "$Scope/$($targets[$i])"
    $spec = 'file:' + ($dirs[$i] -replace '\\', '/')
    Write-Output "  -> reinstall $pkgRef"

    if ($DryRun) {
        Write-Output "     dsh plugin --profile $Profile remove $pkgRef"
        Write-Output "     dsh plugin --profile $Profile add $spec"
        Write-Output "     （真实运行还会：清理 $($targets[$i])_tmp_* 残骸；add 失败最多重试 $AddRetries 次）"
        continue
    }

    # 清理该包的历史 tmp 残骸：pnpm 在 rename(tmp -> 目标) 失败时会留下 <pkg>_tmp_<pid>_<n>，
    # 与下一次 add 的目标名碰撞后持续报 EPERM（本机已实测）。
    foreach ($base in @($nodeModules, $scopeDir)) {
        if (Test-Path -LiteralPath $base) {
            $stale = @(Get-ChildItem -LiteralPath $base -Directory -Filter "$($targets[$i])_tmp_*" -ErrorAction SilentlyContinue)
            foreach ($d in $stale) {
                Write-Output "     (清理残骸 $($d.FullName))"
                Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    try {
        & dsh plugin --profile $Profile remove $pkgRef | Out-Null
    }
    catch {
        Write-Output "     (remove 无匹配项，继续 —— $($_.Exception.Message))"
    }

    # add 重试：Windows 上目录交换偶发 EPERM（杀软/索引器持句柄），重试通常即通过。
    $ok = $false
    for ($attempt = 1; $attempt -le $AddRetries; $attempt++) {
        & dsh plugin --profile $Profile add $spec
        if ($LASTEXITCODE -eq 0) { $ok = $true; break }
        if ($attempt -lt $AddRetries) {
            Write-Output "     add 失败（exit=$LASTEXITCODE），$RetryDelaySec 秒后重试（$attempt/$AddRetries）..."
            Start-Sleep -Seconds $RetryDelaySec
        }
    }
    if (-not $ok) {
        $msg = "dev-reload: add $pkgRef 连续 $AddRetries 次失败（末次 exit=$LASTEXITCODE）。" +
        '常见原因：DSH 正在运行并占用该包目录（请先退出 DSH），或 profile 存在 EPERM 句柄竞争。'
        throw $msg
    }
}

# ---- 4) 配置合成校验（dump-config 不执行 apply，故仅证明组合可合成） ----
if (-not $NoVerify) {
    Write-Output 'dev-reload: 校验配置合成（dump-config）'
    if ($DryRun) {
        Write-Output "     dsh --profile $Profile --dump-config"
    }
    else {
        $dump = & dsh --profile $Profile --dump-config 2>&1
        $exit = $LASTEXITCODE
        $noisy = @($dump | Select-String -Pattern 'warn|error' -CaseSensitive:$false).Count
        Write-Output "     dump-config exit=$exit  可疑行=$noisy"
        if ($exit -ne 0) {
            throw "dev-reload: dump-config 失败（exit=$exit）"
        }
        if ($noisy -gt 0) {
            Write-Output '     注意：出现 warn/error 行，请人工确认（不自动失败）'
        }
    }
}

Write-Output 'dev-reload: 完成。若改动了 lib 产物，请重启 DSH 进程（改动不会热生效）。'

# sync-vendor.ps1 — re-sync vendored markitdown first-party sources and replay local patches.
# Usage:  pwsh -File scripts/sync-vendor.ps1
# Policy (todo Step 2): first-party code is vendored under vendor/markitdown; the upstream
# baseline is recorded in vendor/markitdown/VENDORED_VERSION. Local patches (if any) live in
# scripts/vendor-patches/*.diff and are replayed after the copy. The script NEVER deletes
# vendor state silently — it stops on the first error.
#
# Patch replay is done by scripts/apply-vendor-patches.py, NOT GNU `patch`:
# `patch.exe` on Windows ships only inside Git Bash's MSYS toolchain (/usr/bin/patch.exe) and is
# NOT on the Windows PATH, so a `pwsh`/cmd run would fail to find it. Python is already a hard
# dependency of this repo (the bridge is Python), which removes the external requirement.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcCore = Join-Path $repoRoot 'packages\markitdown\src\markitdown'
$srcOcr  = Join-Path $repoRoot 'packages\markitdown-ocr\src\markitdown_ocr'
$dstRoot = Join-Path $repoRoot 'vendor\markitdown'
$patchDir = Join-Path $repoRoot 'scripts\vendor-patches'
$patcher = Join-Path $repoRoot 'scripts\apply-vendor-patches.py'

if (-not (Test-Path $srcCore)) { throw "source missing: $srcCore" }
if (-not (Test-Path $srcOcr))  { throw "source missing: $srcOcr" }
if (-not (Test-Path $patcher)) { throw "patcher missing: $patcher" }

# Locate an interpreter: prefer the repo venv (guaranteed to exist alongside the bridge),
# fall back to whatever `python` resolves to on PATH.
$venvPython = Join-Path $repoRoot 'dsh-integration\.venv\Scripts\python.exe'
$python = $null
if (Test-Path $venvPython) {
    $python = $venvPython
}
else {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { $python = $cmd.Source }
}
if (-not $python) {
    throw 'no Python interpreter found (neither dsh-integration/.venv/Scripts/python.exe nor python on PATH)'
}


# 1) Back up current vendored tree before touching it (reversible-effects discipline).
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $repoRoot "vendor\.backup-$stamp"
Copy-Item -Path $dstRoot -Destination $backup -Recurse -Force
Write-Output "[1/4] backup -> $backup"

# 2) Refresh first-party sources from the in-repo packages.
Remove-Item -Path (Join-Path $dstRoot 'markitdown')     -Recurse -Force -Confirm:$false
Remove-Item -Path (Join-Path $dstRoot 'markitdown_ocr') -Recurse -Force -Confirm:$false
Copy-Item -Path $srcCore -Destination (Join-Path $dstRoot 'markitdown') -Recurse -Force
Copy-Item -Path $srcOcr  -Destination (Join-Path $dstRoot 'markitdown_ocr') -Recurse -Force
Write-Output '[2/4] sources refreshed'

# 3) Replay recorded local patches (if any) in lexical order.
#    scripts/apply-vendor-patches.py consumes the git-style diffs directly and does NOT require
#    a git work tree (this checkout is not one), whereas `git -C <root> apply` fails outright.
#    A --check pass runs first: the diff must still match the freshly copied upstream baseline,
#    otherwise the patch is stale and we abort BEFORE writing anything.
if (Test-Path $patchDir) {
    $patches = @(Get-ChildItem -Path $patchDir -Filter '*.diff' | Sort-Object Name)
    if ($patches.Count -gt 0) {
        $patchArgs = @($patcher, '--root', $repoRoot)
        foreach ($p in $patches) { $patchArgs += $p.FullName }

        & $python @patchArgs --check
        if ($LASTEXITCODE -ne 0) {
            throw 'patch pre-check failed: a diff no longer matches the upstream baseline. Sources were refreshed but no patch was written; restore from vendor\.backup-* if needed.'
        }

        & $python @patchArgs
        if ($LASTEXITCODE -ne 0) { throw 'vendor patch replay failed' }
        foreach ($p in $patches) { Write-Output "    applied patch: $($p.Name)" }
    }
    else {
        Write-Output '    (no patches recorded)'
    }
}
Write-Output '[3/4] patches replayed'

# 4) Refresh the version anchor (edit VENDORED_VERSION manually if pinning an older baseline).
$coreVersion = (Get-Content (Join-Path $srcCore '__about__.py')) -match '__version__' |
    ForEach-Object { ($_ -split '=')[1].Trim().Trim('"') } | Select-Object -First 1
$ocrVersion = (Get-Content (Join-Path $srcOcr '__about__.py')) -match '__version__' |
    ForEach-Object { ($_ -split '=')[1].Trim().Trim('"') } | Select-Object -First 1
$anchor = Join-Path $dstRoot 'VENDORED_VERSION'
$today = Get-Date -Format 'yyyy-MM-dd'

# Re-emit the FULL anchor including its comment header. The previous version wrote only the
# three KEY=VALUE lines, silently dropping the "Sync policy" note on every sync — which is
# exactly the note that tells the next person to record local edits as diffs.
$anchorLines = @(
    '# Vendored upstream: microsoft/markitdown',
    "# Source: $repoRoot\packages\markitdown + packages\markitdown-ocr",
    "# markitdown core version: $coreVersion",
    "# markitdown-ocr version: $ocrVersion",
    '# Plugin interface version: 1',
    "# Vendored at: $today",
    '# Sync policy: local patches (if any) must be recorded as diffs in scripts/vendor-patches and replayed by sync-vendor.ps1',
    "VENDORED_VERSION=markitdown@$coreVersion+ocr@$ocrVersion",
    'PLUGIN_INTERFACE_VERSION=1',
    "VENDORED_AT=$today"
)
# No BOM + LF, so the anchor stays byte-stable and the first line is never a stray U+FEFF.
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($anchor, (($anchorLines -join "`n") + "`n"), $utf8NoBom)
Write-Output "[4/4] version anchor updated -> VENDORED_VERSION=markitdown@$coreVersion+ocr@$ocrVersion"
Write-Output 'Done. Remember to update dsh-markitdown-worker cordis.yml expectedVendorVersion if it was pinned.'

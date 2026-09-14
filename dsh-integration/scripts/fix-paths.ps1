<#
.SYNOPSIS
  Rewrite machine-specific path declarations in the markitdown x DSH integration tree.

.DESCRIPTION
  Three declarations embed absolute machine paths and must be rewritten per machine:
    1. dsh-integration/dsh-markitdown-worker/package.json -> dependencies["@kiwifruit/dsh-markitdown"]
    2. dsh-integration/dsh-tool-markitdown/package.json   -> dependencies["@kiwifruit/dsh-markitdown"]
    3. dsh-integration/tsconfig.base.json                 -> compilerOptions.paths["@deepseek-ai/*"]

  Why link: and not a semver range: these packages are NOT published yet. A semver
  range (for example "*") resolves against the npm registry, which already hosts an
  unscoped third-party "dsh-markitdown" (observed 0.1.1). pnpm would silently install
  that stranger instead of the local definition package. See dsh-integration/README.md.

.PARAMETER RepoRoot
  Repository root (the directory that contains dsh-integration). Defaults to the
  parent of the parent of this script's directory.

.PARAMETER DshHome
  DSH_HOME used to resolve the shared node_modules. Defaults to $env:USERPROFILE\.dsh.

.PARAMETER DryRun
  Print the planned changes without writing anything.

.EXAMPLE
  pwsh -File dsh-integration/scripts/fix-paths.ps1 -DryRun

.EXAMPLE
  pwsh -File dsh-integration/scripts/fix-paths.ps1 -DshHome 'D:/dsh'
#>
[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$DshHome,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
}
if (-not $DshHome) {
    $DshHome = Join-Path $env:USERPROFILE '.dsh'
}
if (-not (Test-Path -LiteralPath $RepoRoot)) {
    throw "RepoRoot not found: $RepoRoot"
}

$rootNorm = ($RepoRoot -replace '\\', '/').TrimEnd('/')
$dshNorm = ($DshHome -replace '\\', '/').TrimEnd('/')

# Escape '$' so the literal value survives .NET regex substitution semantics.
$linkValue = ("link:$rootNorm/dsh-integration/dsh-markitdown").Replace('$', '$$')
$pathsValue = ("$dshNorm/profiles/node_modules/@deepseek-ai/*").Replace('$', '$$')

$specs = @(
    [pscustomobject]@{
        Relative = 'dsh-integration/dsh-markitdown-worker/package.json'
        Pattern  = '(?m)^(\s*)"@kiwifruit/dsh-markitdown"\s*:\s*".*?"'
        Value    = '$1"@kiwifruit/dsh-markitdown": "' + $linkValue + '"'
    }
    [pscustomobject]@{
        Relative = 'dsh-integration/dsh-tool-markitdown/package.json'
        Pattern  = '(?m)^(\s*)"@kiwifruit/dsh-markitdown"\s*:\s*".*?"'
        Value    = '$1"@kiwifruit/dsh-markitdown": "' + $linkValue + '"'
    }
    [pscustomobject]@{
        Relative = 'dsh-integration/tsconfig.base.json'
        Pattern  = '(?m)^(\s*)"@deepseek-ai/\*"\s*:\s*\[".*?"\]'
        Value    = '$1"@deepseek-ai/*": ["' + $pathsValue + '"]'
    }
)

$changed = 0
foreach ($spec in $specs) {
    $full = Join-Path $RepoRoot $spec.Relative
    if (-not (Test-Path -LiteralPath $full)) {
        Write-Warning "skip (missing): $($spec.Relative)"
        continue
    }

    $original = [System.IO.File]::ReadAllText($full)
    $updated = [regex]::Replace($original, $spec.Pattern, $spec.Value)

    if ($updated -eq $original) {
        Write-Output "unchanged: $($spec.Relative)"
        continue
    }

    $changed = $changed + 1

    if ($DryRun) {
        Write-Output "would-fix: $($spec.Relative)"
        continue
    }

    Copy-Item -LiteralPath $full -Destination ($full + '.pathfix.bak') -Force
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($full, $updated, $utf8NoBom)
    Write-Output "fixed: $($spec.Relative)"
}

if ($DryRun) {
    Write-Output "dry-run complete: $changed file(s) would change"
} else {
    Write-Output "done: $changed file(s) rewritten (backups use .pathfix.bak)"
}

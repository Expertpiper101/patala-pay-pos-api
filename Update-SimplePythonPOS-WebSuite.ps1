$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

param(
    [string]$TargetRoot = ""
)

function Get-DefaultTargetRoot {
    $candidates = @(
        "C:\mos",
        (Split-Path -Parent $PSScriptRoot),
        "C:\SimplePythonPOSWeb"
    )
    foreach ($candidate in $candidates) {
        if (
            (Test-Path -LiteralPath (Join-Path $candidate "simple-python-pos-api")) -and
            (Test-Path -LiteralPath (Join-Path $candidate "simple-python-pos-web")) -and
            (Test-Path -LiteralPath (Join-Path $candidate "simple-python-pos-storefront"))
        ) {
            return $candidate
        }
    }
    throw "Could not find the installed local web suite folder. Pass -TargetRoot if needed."
}

$packageRoot = $PSScriptRoot
$sourceApi = Join-Path $packageRoot "simple-python-pos-api"
$sourceWeb = Join-Path $packageRoot "simple-python-pos-web"
$sourceStore = Join-Path $packageRoot "simple-python-pos-storefront"

if (-not (Test-Path -LiteralPath (Join-Path $sourceApi "server.js"))) {
    throw "Update package is missing simple-python-pos-api\server.js"
}

$targetBase = if ($TargetRoot) { $TargetRoot } else { Get-DefaultTargetRoot }
$targetApi = Join-Path $targetBase "simple-python-pos-api"
$targetWeb = Join-Path $targetBase "simple-python-pos-web"
$targetStore = Join-Path $targetBase "simple-python-pos-storefront"

if (Test-Path -LiteralPath (Join-Path $targetApi "stop-local-suite.ps1")) {
    powershell -ExecutionPolicy Bypass -File (Join-Path $targetApi "stop-local-suite.ps1") | Out-Null
    Start-Sleep -Seconds 1
}

Write-Output "Updating local web suite in $targetBase"
robocopy $sourceApi $targetApi /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "API update copy failed with robocopy exit code $LASTEXITCODE" }
robocopy $sourceWeb $targetWeb /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Admin update copy failed with robocopy exit code $LASTEXITCODE" }
robocopy $sourceStore $targetStore /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Storefront update copy failed with robocopy exit code $LASTEXITCODE" }

powershell -ExecutionPolicy Bypass -File (Join-Path $targetApi "start-local-suite.ps1") | Out-Null

Write-Output "Local web suite update complete."

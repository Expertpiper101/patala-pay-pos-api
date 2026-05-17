$ErrorActionPreference = "SilentlyContinue"

$apiRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = Join-Path $env:APPDATA "SimplePythonPOS\\local-web-suite"
$pidsRoot = Join-Path $runtimeRoot "pids"

function Stop-ManagedProcess {
    param([string]$Name)

    $pidFile = Join-Path $pidsRoot "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) {
        return
    }

    $rawPid = Get-Content -LiteralPath $pidFile | Select-Object -First 1
    if ($rawPid) {
        Stop-Process -Id ([int]$rawPid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Stop-ManagedProcess -Name "pos-storefront"
Stop-ManagedProcess -Name "pos-admin"
Stop-ManagedProcess -Name "pos-api"

Write-Output "Local POS web suite stopped."

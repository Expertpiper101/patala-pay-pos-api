$ErrorActionPreference = "Stop"

$apiRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDbPath = Join-Path (Split-Path -Parent $apiRoot) "simple-python-pos\data\pos.db"

if (-not (Test-Path -LiteralPath $projectDbPath)) {
    throw "Project database not found at $projectDbPath"
}

$env:SIMPLE_POS_DB_PATH = $projectDbPath
$env:SIMPLE_POS_USE_PROJECT_DB = "1"

& (Join-Path $apiRoot "start-local-suite.ps1")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$apiRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectsRoot = Split-Path -Parent $apiRoot
$packageRoot = Join-Path $projectsRoot "simple-python-pos-web-update"
$zipPath = Join-Path $projectsRoot "simple-python-pos-web-update.zip"

$adminDist = Join-Path $projectsRoot "simple-python-pos-web\dist"
$storeDist = Join-Path $projectsRoot "simple-python-pos-storefront\dist"

if (-not (Test-Path -LiteralPath $adminDist)) {
    throw "Admin dist build not found at $adminDist. Build the local suite first."
}
if (-not (Test-Path -LiteralPath $storeDist)) {
    throw "Storefront dist build not found at $storeDist. Build the local suite first."
}

Remove-Item -Recurse -Force $packageRoot -ErrorAction SilentlyContinue
Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot "simple-python-pos-api") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot "simple-python-pos-web") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot "simple-python-pos-storefront") | Out-Null

Copy-Item -Recurse -Force (Join-Path $apiRoot "*") (Join-Path $packageRoot "simple-python-pos-api")
Copy-Item -Recurse -Force $adminDist (Join-Path $packageRoot "simple-python-pos-web\dist")
Copy-Item -Recurse -Force $storeDist (Join-Path $packageRoot "simple-python-pos-storefront\dist")
Copy-Item -Force (Join-Path $apiRoot "Update-SimplePythonPOS-WebSuite.ps1") $packageRoot
Copy-Item -Force (Join-Path $apiRoot "RUN-THIS-TO-UPDATE-WEB.txt") $packageRoot

$readme = @"
Simple Python POS Local Web Suite Update Package

How to use:
1. Extract this zip on the client machine.
2. Right-click Update-SimplePythonPOS-WebSuite.ps1 and run with PowerShell.
3. The script updates the local API, admin, and storefront files, then restarts the local web suite.
"@
Set-Content -LiteralPath (Join-Path $packageRoot "README-UPDATE.txt") -Value $readme -Encoding UTF8

Compress-Archive -Path "$packageRoot\*" -DestinationPath $zipPath -Force

Write-Output "Web suite update package created at $zipPath"

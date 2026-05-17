Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$apiRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectsRoot = Split-Path -Parent $apiRoot
$packageRoot = Join-Path $projectsRoot "simple-python-pos-web-suite-x86"
$zipPath = Join-Path $projectsRoot "simple-python-pos-web-suite-x86.zip"

Remove-Item -Recurse -Force $packageRoot -ErrorAction SilentlyContinue
Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null

$apiPackageRoot = Join-Path $packageRoot "simple-python-pos-api"
$adminPackageRoot = Join-Path $packageRoot "simple-python-pos-web"
$storePackageRoot = Join-Path $packageRoot "simple-python-pos-storefront"

New-Item -ItemType Directory -Force -Path $apiPackageRoot | Out-Null
New-Item -ItemType Directory -Force -Path $adminPackageRoot | Out-Null
New-Item -ItemType Directory -Force -Path $storePackageRoot | Out-Null

Copy-Item -Recurse -Force (Join-Path $projectsRoot "simple-python-pos-api\\*") $apiPackageRoot
Copy-Item -Recurse -Force (Join-Path $projectsRoot "simple-python-pos-web\\dist") (Join-Path $adminPackageRoot "dist")
Copy-Item -Recurse -Force (Join-Path $projectsRoot "simple-python-pos-storefront\\dist") (Join-Path $storePackageRoot "dist")

Compress-Archive -Path "$packageRoot\\*" -DestinationPath $zipPath -Force

Write-Output "Client web suite package created at $zipPath"

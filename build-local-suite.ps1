$ErrorActionPreference = "Stop"

$projectsRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$adminRoot = Join-Path $projectsRoot "simple-python-pos-web"
$storefrontRoot = Join-Path $projectsRoot "simple-python-pos-storefront"

Push-Location $adminRoot
try {
    npm run build
} finally {
    Pop-Location
}

Push-Location $storefrontRoot
try {
    npm run build
} finally {
    Pop-Location
}

Write-Output "Local POS web suite builds refreshed."

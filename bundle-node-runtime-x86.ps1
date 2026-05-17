Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$apiRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = Join-Path $apiRoot "runtime"
$targetRoot = Join-Path $runtimeRoot "node-x86"
$zipPath = Join-Path $env:TEMP "node-v21.6.1-win-x86.zip"
$downloadUrl = "https://nodejs.org/dist/v21.6.1/node-v21.6.1-win-x86.zip"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
Remove-Item -Recurse -Force $targetRoot -ErrorAction SilentlyContinue

Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
Expand-Archive -LiteralPath $zipPath -DestinationPath $runtimeRoot -Force
Rename-Item -LiteralPath (Join-Path $runtimeRoot "node-v21.6.1-win-x86") -NewName "node-x86"

Write-Output "Bundled x86 Node runtime ready at $targetRoot"

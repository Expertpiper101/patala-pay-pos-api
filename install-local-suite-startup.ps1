$ErrorActionPreference = "Stop"

$apiRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startupFolder = Join-Path $env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs\\Startup"
$launcherPath = Join-Path $startupFolder "SimplePythonPOSLocalWebSuite.vbs"
$scriptPath = Join-Path $apiRoot "start-local-suite.ps1"

$launcher = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$scriptPath""", 0, False
"@

New-Item -ItemType Directory -Force -Path $startupFolder | Out-Null
Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding ASCII

Write-Output "Startup launcher installed at $launcherPath"
Write-Output "The local POS admin and storefront will now start automatically when this Windows user signs in."

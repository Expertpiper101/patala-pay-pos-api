$ErrorActionPreference = "Stop"

$apiRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectsRoot = Split-Path -Parent $apiRoot
$adminRoot = Join-Path $projectsRoot "simple-python-pos-web\\dist"
$storefrontRoot = Join-Path $projectsRoot "simple-python-pos-storefront\\dist"
$defaultDataRoot = Join-Path $env:APPDATA "SimplePythonPOS"
$dataDbPath = if ($env:SIMPLE_POS_DB_PATH) { $env:SIMPLE_POS_DB_PATH } else { Join-Path $defaultDataRoot "data\\pos.db" }
$dataRoot = Split-Path -Parent (Split-Path -Parent $dataDbPath)
$runtimeRoot = Join-Path $dataRoot "local-web-suite"
$logsRoot = Join-Path $runtimeRoot "logs"
$pidsRoot = Join-Path $runtimeRoot "pids"
$bundledNodeCandidates = @(
    (Join-Path $apiRoot "runtime\\node-x86\\node.exe"),
    (Join-Path $apiRoot "runtime\\node-x64\\node.exe"),
    (Join-Path $apiRoot "runtime\\node\\node.exe")
)

$nodeExe = $null
foreach ($candidate in $bundledNodeCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        $nodeExe = $candidate
        break
    }
}

if (-not $nodeExe) {
    $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
}

New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null
New-Item -ItemType Directory -Force -Path $pidsRoot | Out-Null

function Stop-ManagedProcess {
    param([string]$PidFile)
    if (-not (Test-Path -LiteralPath $PidFile)) {
        return
    }

    $rawPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $rawPid) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        return
    }

    $existingProcess = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
    if ($existingProcess) {
        Stop-Process -Id $existingProcess.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }

    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Start-ManagedNodeService {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string[]]$Arguments,
        [hashtable]$Environment = @{}
    )

    $pidFile = Join-Path $pidsRoot "$Name.pid"
    $stdoutFile = Join-Path $logsRoot "$Name.log"
    $stderrFile = Join-Path $logsRoot "$Name.err.log"

    Stop-ManagedProcess -PidFile $pidFile

    function Quote-PsLiteral([string]$value) {
        return "'" + ($value -replace "'", "''") + "'"
    }

    $envLines = foreach ($entry in $Environment.GetEnumerator()) {
        '$env:' + $entry.Key + '=' + (Quote-PsLiteral ([string]$entry.Value))
    }
    $argLiterals = ($Arguments | ForEach-Object { Quote-PsLiteral ([string]$_) }) -join ", "
    $command = @(
        '$ErrorActionPreference = ''Stop'''
        '$ProgressPreference = ''SilentlyContinue'''
        '$wd = ' + (Quote-PsLiteral $WorkingDirectory)
        'Set-Location -LiteralPath $wd'
        $envLines
        '$node = ' + (Quote-PsLiteral $nodeExe)
        '$args = @(' + $argLiterals + ')'
        '& $node @args 1>> ' + (Quote-PsLiteral $stdoutFile) + ' 2>> ' + (Quote-PsLiteral $stderrFile)
    ) -join '; '
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))

    $process = Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", $encoded) `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -LiteralPath $pidFile -Value $process.Id
}

if (-not (Test-Path -LiteralPath (Join-Path $apiRoot "server.js"))) {
    throw "Could not find the POS API files at $apiRoot"
}

if (-not (Test-Path -LiteralPath $adminRoot)) {
    throw "Admin build output was not found at $adminRoot. Run the admin web build first."
}

if (-not (Test-Path -LiteralPath $storefrontRoot)) {
    throw "Storefront build output was not found at $storefrontRoot. Run the storefront build first."
}

Start-ManagedNodeService -Name "pos-api" -WorkingDirectory $apiRoot -Arguments @("server.js") -Environment @{
    SIMPLE_POS_DB_PATH = $dataDbPath
}
Start-ManagedNodeService -Name "pos-admin" -WorkingDirectory $apiRoot -Arguments @("static-server.mjs", "--root", $adminRoot, "--port", "8083", "--host", "127.0.0.1", "--name", "admin")
Start-ManagedNodeService -Name "pos-storefront" -WorkingDirectory $apiRoot -Arguments @("static-server.mjs", "--root", $storefrontRoot, "--port", "8084", "--host", "127.0.0.1", "--name", "storefront")

Write-Output "Local POS web suite started."
Write-Output "Admin: http://127.0.0.1:8083"
Write-Output "Storefront: http://127.0.0.1:8084"
Write-Output "API: http://127.0.0.1:8090"

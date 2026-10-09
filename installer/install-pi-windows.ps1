$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# A parent PowerShell 7 process can pass its module path to Windows PowerShell.
$env:PSModulePath = $env:PSModulePath + ';' + (Join-Path $PSHOME 'Modules')
function Get-InstallerSHA256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
$PackageName = '@earendil-works/pi-coding-agent'
$PackageVersion = '0.84.4'
$MinimumNodeVersion = [Version]'22.19.0'
$UserNpmPrefix = Join-Path $env:APPDATA 'npm'
$TaskKey = $env:PI_API_KEY
$TaskBase = $env:PI_BASE_URL
$TaskProvider = if ($env:PI_PROVIDER_NAME) { $env:PI_PROVIDER_NAME } else { 'router' }
$TaskDefault = $env:PI_DEFAULT_MODEL
$TaskConfigDir = $env:PI_CODING_AGENT_DIR
Remove-Item Env:PI_API_KEY,Env:PI_BASE_URL,Env:PI_PROVIDER_NAME,Env:PI_DEFAULT_MODEL -ErrorAction SilentlyContinue
$TaskSource = 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/f2db9fb7421192b04d113d44f4ef43bd51a06ac9'
if ([string]::IsNullOrWhiteSpace($TaskBase)) { throw 'Set PI_BASE_URL to your API address, including /v1.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
function Write-Ok([string]$Message) {
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "[!] $Message" -ForegroundColor Yellow
}

function Write-Err([string]$Message) {
    Write-Host "[ERR] $Message" -ForegroundColor Red
}

function Write-Step([string]$Message) {
    Write-Host "`n>>> $Message" -ForegroundColor Cyan
}

function Refresh-ProcessPath {
    $currentPath = $env:Path
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = @($currentPath, $machinePath, $userPath) -join ';'

    $nodePath = Join-Path $env:ProgramFiles 'nodejs'
    if ((Test-Path -LiteralPath $nodePath) -and ($env:Path -notlike "*$nodePath*")) {
        $env:Path = "$nodePath;$env:Path"
    }
}

function Get-NpmCommand {
    $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $command) {
        $command = Get-Command npm -ErrorAction SilentlyContinue
    }
    return $command
}

function Get-PiCommand {
    $command = Get-Command pi.cmd -ErrorAction SilentlyContinue
    if (-not $command) {
        $command = Get-Command pi -ErrorAction SilentlyContinue
    }
    return $command
}

function Get-InstalledNodeVersion {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) {
        return $null
    }

    try {
        $raw = (& $node.Source --version).Trim().TrimStart('v')
        return [Version]$raw
    }
    catch {
        return $null
    }
}

function Install-NodeIfNeeded {
    Write-Step 'Checking Node.js and npm'
    Refresh-ProcessPath

    $nodeVersion = Get-InstalledNodeVersion
    $npm = Get-NpmCommand

    if ($nodeVersion -and $npm -and $nodeVersion -ge $MinimumNodeVersion) {
        Write-Ok "Node.js v$nodeVersion, npm $((& $npm.Source --version).Trim())"
        return
    }

    Write-Step 'Installing a private Node.js runtime with npm'
    $taskArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
    $taskRuntimeName = "node-v22.22.2-win-$taskArch"
    $taskRuntimeRoot = Join-Path $env:LOCALAPPDATA 'pi-runtime'
    $taskRuntimePath = Join-Path $taskRuntimeRoot $taskRuntimeName
    New-Item -ItemType Directory -Path $taskRuntimeRoot -Force | Out-Null
    $taskArchive = Join-Path $taskRuntimeRoot "$taskRuntimeName.zip"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v22.22.2/$taskRuntimeName.zip" -OutFile $taskArchive
        $taskSums = (Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v22.22.2/SHASUMS256.txt').Content
        $taskHashLine = $taskSums -split "`n" | Where-Object { $_.Trim().EndsWith(" $taskRuntimeName.zip") } | Select-Object -First 1
        if (-not $taskHashLine -or (Get-InstallerSHA256 $taskArchive) -ne ($taskHashLine.Trim() -split '\s+')[0]) { throw 'Node.js integrity check failed.' }
        Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1') -ErrorAction Stop
        Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskRuntimeRoot -Force
    } finally { if (Test-Path -LiteralPath $taskArchive) { Remove-Item -LiteralPath $taskArchive -Force } }
    Add-UserPathEntry -Entry $taskRuntimePath
    $env:Path = "$taskRuntimePath;$env:Path"
    $nodeVersion = Get-InstalledNodeVersion
    $npm = Get-NpmCommand
    if (-not $nodeVersion -or -not $npm -or $nodeVersion -lt $MinimumNodeVersion) { throw 'Private Node.js runtime could not be initialized.' }
    Write-Ok "Node.js v$nodeVersion, npm $((& $npm.Source --version).Trim())"
}

function Add-UserPathEntry([string]$Entry) {
    if (-not (Test-Path -LiteralPath $Entry)) {
        New-Item -ItemType Directory -Path $Entry -Force | Out-Null
    }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if (-not [string]::IsNullOrWhiteSpace($userPath)) {
        $entries = $userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    }

    $alreadyInUserPath = $false
    foreach ($existingEntry in $entries) {
        if ($existingEntry.TrimEnd('\') -ieq $Entry.TrimEnd('\')) {
            $alreadyInUserPath = $true
            break
        }
    }

    if (-not $alreadyInUserPath) {
        $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) {
            $Entry
        }
        else {
            "$userPath;$Entry"
        }
        [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
    }

    $processEntries = $env:Path -split ';'
    $alreadyInProcessPath = $false
    foreach ($existingEntry in $processEntries) {
        if ($existingEntry.TrimEnd('\') -ieq $Entry.TrimEnd('\')) {
            $alreadyInProcessPath = $true
            break
        }
    }

    if (-not $alreadyInProcessPath) {
        $env:Path = "$Entry;$env:Path"
    }
}

function Install-OrUpdatePi {
    Write-Step 'Installing or updating Pi'

    $npm = Get-NpmCommand
    if (-not $npm) {
        throw 'npm was not found.'
    }

    Add-UserPathEntry -Entry $UserNpmPrefix

    & $npm.Source install `
        --global `
        --prefix $UserNpmPrefix `
        "${PackageName}@${PackageVersion}" `
        --ignore-scripts `
        --no-audit `
        --no-fund `
        --no-progress `
        --loglevel=warn

    if ($LASTEXITCODE -ne 0) {
        throw "npm could not install $PackageName. Exit code: $LASTEXITCODE"
    }

    Refresh-ProcessPath
    Add-UserPathEntry -Entry $UserNpmPrefix

    $pi = Get-PiCommand
    if (-not $pi) {
        throw 'Pi was installed, but the pi command could not be found.'
    }

    $version = (& $pi.Source --version 2>$null | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($version)) {
        $version = 'version unavailable'
    }
    Write-Ok "Pi installed: $version"
}


if ($env:PI_SKIP_INSTALL -ne '1') {
    Install-NodeIfNeeded
    Install-OrUpdatePi
} elseif ((Get-InstalledNodeVersion) -lt $MinimumNodeVersion) { throw 'Node.js >=22.19 is required.' }
$TaskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$TaskTemp = Join-Path $TaskTempRoot ('pi-router-install.' + [guid]::NewGuid().ToString('N'))
$TaskManifest = @{
    'index.ts' = '96cf696860a00cddc2723ab9bdee323a3c6e6afdb801b62b5bfd21ac33019788'
    'models.mjs' = 'fe484ac7229d50a343ec06e810bca31eba722abdb84d5bb803d8267839ffbe8a'
    'progress.mjs' = '3590b43cb261209a4cc4eb36de959e6112802286e2750ee778380341b31e0dc0'
    'safety.mjs' = '76bdeccad825b281882456f7d69a7352b964f5df1dc6ab969b0b2301c2c135ba'
    'installer/configure.mjs' = '8d9e00f8a2d4e763bbb8b6bc2734c89448d121b3ae88dd0bfe828a6971a96837'
}
try {
    foreach ($TaskFile in $TaskManifest.Keys) {
        $TaskTarget = Join-Path $TaskTemp $TaskFile
        New-Item -ItemType Directory -Path (Split-Path -Parent $TaskTarget) -Force | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri "$TaskSource/$TaskFile" -OutFile $TaskTarget
        if ((Get-InstallerSHA256 $TaskTarget) -ne $TaskManifest[$TaskFile]) { throw 'Extension integrity check failed.' }
    }
    $TaskPayload = @{ apiKey=$TaskKey; baseURL=$TaskBase; provider=$TaskProvider; defaultModel=$TaskDefault; configDir=$TaskConfigDir } | ConvertTo-Json -Compress
    $TaskNode = Get-Command node.exe -ErrorAction Stop
    $TaskPreviousEncoding = $OutputEncoding
    try {
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        $TaskPayload | & $TaskNode.Source (Join-Path $TaskTemp 'installer/configure.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Could not configure pi. Check the API address, key and existing JSON configuration.' }
    } finally { $OutputEncoding = $TaskPreviousEncoding; $TaskPayload=$null; $TaskKey=$null }
} finally {
    $TaskResolved = [IO.Path]::GetFullPath($TaskTemp)
    if (!$TaskResolved.StartsWith($TaskTempRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $TaskResolved) -notlike 'pi-router-install.*') { throw 'Unexpected temporary directory.' }
    if (Test-Path -LiteralPath $TaskResolved) { Remove-Item -LiteralPath $TaskResolved -Recurse -Force }
    $TaskKey=$null
}
if ($env:PI_NO_START -ne '1') {
    Refresh-ProcessPath
    $TaskPi = Get-PiCommand
    if (!$TaskPi) { throw 'Pi is installed. Open a new terminal and run: pi' }
    & $TaskPi.Source
}

$ErrorActionPreference = 'Stop'
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
$TaskSource = 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/84fbad3027aed51e3e4cf01358dd296cc916a8a6'
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

    if ($nodeVersion) {
        Write-Warn "Node.js v$nodeVersion is too old. Pi requires Node.js $MinimumNodeVersion or newer."
    }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw 'A supported Node.js version was not found and winget is unavailable. Install the current Node.js LTS and run the installer again.'
    }

    Write-Step 'Installing or upgrading Node.js LTS through winget'

    if ($nodeVersion) {
        & $winget.Source upgrade `
            --id OpenJS.NodeJS.LTS `
            --exact `
            --source winget `
            --accept-package-agreements `
            --accept-source-agreements `
            --silent `
            --disable-interactivity

        if ($LASTEXITCODE -ne 0) {
            & $winget.Source install `
                --id OpenJS.NodeJS.LTS `
                --exact `
                --source winget `
                --accept-package-agreements `
                --accept-source-agreements `
                --silent `
                --disable-interactivity
        }
    }
    else {
        & $winget.Source install `
            --id OpenJS.NodeJS.LTS `
            --exact `
            --source winget `
            --accept-package-agreements `
            --accept-source-agreements `
            --silent `
            --disable-interactivity
    }

    Refresh-ProcessPath
    $nodeVersion = Get-InstalledNodeVersion
    $npm = Get-NpmCommand

    if (-not $nodeVersion -or -not $npm -or $nodeVersion -lt $MinimumNodeVersion) {
        throw 'Node.js was installed or upgraded, but the required version is not available in the current PowerShell session. Close PowerShell, open it again, and rerun the installer.'
    }

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
    'installer/configure.mjs' = 'e8bdd8134b5eda578a791a3d2e9154ababc1fc9af5e2f29f44f6e0145fc79633'
}
try {
    foreach ($TaskFile in $TaskManifest.Keys) {
        $TaskTarget = Join-Path $TaskTemp $TaskFile
        New-Item -ItemType Directory -Path (Split-Path -Parent $TaskTarget) -Force | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri "$TaskSource/$TaskFile" -OutFile $TaskTarget
        if ((Get-FileHash -LiteralPath $TaskTarget -Algorithm SHA256).Hash.ToLowerInvariant() -ne $TaskManifest[$TaskFile]) { throw 'Extension integrity check failed.' }
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

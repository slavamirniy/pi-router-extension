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
$TaskSource = 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/61896fc72b35e4ee01b0e7ac5824388f38169d51'
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
    'installer/configure.mjs' = '05baf93605429026e37a06b4ee35e1121100dc1877f191e87cbfcf9d14d529e9'
    'installer/friendly.mjs' = '5b3fd6778d5aec49aa27676c2409ebfe998a0e72c9c57c5eac2ee2eacd18f49e'
    'installer/pi-friendly/bundle.json' = '92ca6c017638545726b40a8776c4da00da44f6158b9b29adb778cdb37b394f6a'
    'installer/pi-friendly/activity.mjs' = '88e5d10d5f4058038744f5ed9787edc81bb2e0990288bfed172d4216f8d9fb8c'
    'installer/pi-friendly/buttons.mjs' = '870d02159a8d3fa90f400276459bae9cfeb91b443b10b6322358dcb53223ae46'
    'installer/pi-friendly/errors.mjs' = '567914532d7fc26c9203fec036a87419f70b039e1b6e6e65e06edcdb0bf2c327'
    'installer/pi-friendly/exit-dialog.mjs' = 'e85803f9c57bd95c8b9f8040da386cc53ee3ded41decead873464cfd2601e01c'
    'installer/pi-friendly/friendly.mjs' = '3b8881b2121d2750f4d6ff416f60278d2020f2596dff378f7c91fea14516295e'
    'installer/pi-friendly/index.ts' = 'cbb2eddb3f8b7e723a17f7b66cf9f7c780e10ddac75bdf78c17df728fd294e51'
    'installer/pi-friendly/LICENSE' = '94a5c5d74147e19c336747bda0baa9c923363cb3fac320f95743cba72a59d186'
    'installer/pi-friendly/menu.mjs' = '1780b88576fdcf454b9245cd6d03c1a7e546bca9da3e610e97617371a562ba0c'
    'installer/pi-friendly/mouse.mjs' = '89a96d8efb03719f430c81d4ae4e2c3a71c25cc17d616f917b84c1c1ca1b7316'
    'installer/pi-friendly/package.json' = '667633413dbed53a7d628be614f3372f05912ff111c2d6fc8456ceac6312cf32'
    'installer/pi-friendly/project-form.mjs' = '99ab58e81df761612baf5860f93eb358873f435a71419cb27ef8998d7787aa2e'
    'installer/pi-friendly/projects.mjs' = 'f05b74ca86aee59af05c5e34a316ca571466773df1e8d3d611ce3c961e6b4eee'
    'installer/pi-friendly/README.md' = 'e013dba0c222fb6a9728f45359f06a18f069f1636107c592186d1b737533ec14'
    'installer/pi-friendly/surface.mjs' = '5c9f4c9f5ad6189ae462ccd6fbbe0d6e158f9b62e17cd5420bd005a6ea616df7'
    'installer/pi-friendly/voice_audio.py' = '659fdd63d58e4d6721ef64aba76ce91994e2704f8c7a0d73bfcc2bfecd762da6'
    'installer/pi-friendly/voice-setup.mjs' = 'c545311ab52c4e1a09cf02662d6c2ae52e8561c0ad05fb6e96f87d83f32b988f'
    'installer/pi-friendly/voice-worker.py' = '5e0119a3b732a70ca4019f9dea5c20802892d9b4f3af83750f096c457d94d55d'
    'installer/pi-friendly/voice.mjs' = '17cce904c157c2bcb1cf162a66c3c70fded45cf63a8328d6a6e0ddca5f28eb60'
    'installer/pi-friendly/workspace.mjs' = '4633ac096a57d37709de536ad37f1b5fad36381feccd74db64e40d0a7a31ae03'
}
try {
    foreach ($TaskFile in $TaskManifest.Keys) {
        $TaskTarget = Join-Path $TaskTemp $TaskFile
        New-Item -ItemType Directory -Path (Split-Path -Parent $TaskTarget) -Force | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri "$TaskSource/$TaskFile" -OutFile $TaskTarget
        if ((Get-InstallerSHA256 $TaskTarget) -ne $TaskManifest[$TaskFile]) { throw 'Extension integrity check failed.' }
    }
    $TaskPayload = @{ apiKey=$TaskKey; baseURL=$TaskBase; provider=$TaskProvider; defaultModel=$TaskDefault; configDir=$TaskConfigDir } | ConvertTo-Json -Compress
    # Windows PowerShell can use an inherited ASCII pipeline encoding inside a
    # function invoked through iex. ASCII JSON escapes preserve Unicode paths
    # and credentials regardless of the caller's console/pipeline code page.
    $TaskPayload = [regex]::Replace($TaskPayload, '[^\x00-\x7F]', { param($match) '\u{0:x4}' -f [int][char]$match.Value[0] })
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
function Install-DesktopShortcut {
    $taskBrandRoot = Join-Path $env:LOCALAPPDATA 'AI-DIY'
    $taskProjects = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'AI DIY Projects'
    $taskDesktop = [Environment]::GetFolderPath('DesktopDirectory')
    New-Item -ItemType Directory -Path $taskBrandRoot,$taskProjects,$taskDesktop -Force | Out-Null
    $taskIcon = Join-Path $taskBrandRoot 'ai-diy.ico'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/cc566974dd517f4c438aa84ca6ac05a3eb5defac/assets/ai-diy.ico' -OutFile $taskIcon
    if ((Get-InstallerSHA256 $taskIcon) -ne '6075a4bc83a2dfb866c778ebab36ea49ea45647ba2dabb0d45484088a904db6a') { throw 'Desktop icon integrity check failed.' }
    $taskNodeFolder = Split-Path -Parent (Get-Command node.exe -ErrorAction Stop).Source
    $taskPiCommand = (Get-PiCommand).Source
    if (!$taskPiCommand) { throw 'Pi command is unavailable for the desktop shortcut.' }
    $taskLauncher = Join-Path $taskBrandRoot 'launch.cmd'
    $taskLaunchText = "@echo off`r`nsetlocal`r`nset `"PATH=" + $taskNodeFolder.Replace('%','%%') + ";" + $UserNpmPrefix.Replace('%','%%') + ";%PATH%`"`r`ncd /d `"" + $taskProjects.Replace('%','%%') + "`"`r`ncall `"" + $taskPiCommand.Replace('%','%%') + "`"`r`nif errorlevel 1 pause`r`n"
    # cmd reads the system code page; generated paths may contain Cyrillic.
    [IO.File]::WriteAllText($taskLauncher, "@chcp 65001 >nul`r`n" + $taskLaunchText, [Text.UTF8Encoding]::new($false))
    $taskShell = New-Object -ComObject WScript.Shell
    $taskLink = $taskShell.CreateShortcut((Join-Path $taskDesktop 'AI своими руками.lnk'))
    $taskLink.TargetPath = $env:ComSpec
    $taskLink.Arguments = '/d /c ""' + $taskLauncher + '""'
    $taskLink.WorkingDirectory = $taskProjects
    $taskLink.IconLocation = $taskIcon + ',0'
    $taskLink.Description = 'AI своими руками'
    $taskLink.Save()
    Write-Ok 'Desktop shortcut created. Projects: Documents/AI DIY Projects'
}
if ($env:PI_NO_SHORTCUT -ne '1') { Install-DesktopShortcut }
if ($env:PI_NO_START -ne '1') {
    Refresh-ProcessPath
    $TaskPi = Get-PiCommand
    if (!$TaskPi) { throw 'Pi is installed. Open a new terminal and run: pi' }
    Set-Location -LiteralPath (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'AI DIY Projects')
    & $TaskPi.Source
}

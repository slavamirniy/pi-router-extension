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
$TaskSource = 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/8b4e16c7733942a201e2048a4868232ec2370403'
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

    $taskExistingPi = Get-PiCommand
    if ($taskExistingPi) {
        # Read the process to completion: Select-Object -First inside the native
        # pipeline can terminate pi.cmd early and report exit -1 on Windows.
        $taskVersionOutput = @(& $taskExistingPi.Source --version 2>$null)
        $taskVersionExit = $LASTEXITCODE
        $taskInstalledVersion = $taskVersionOutput | Select-Object -First 1
        if ($taskVersionExit -eq 0 -and ([string]$taskInstalledVersion).Trim() -match '^\d+\.\d+\.\d+') {
            Write-Ok "Using installed Pi $taskInstalledVersion. Updating connection and plugins only."
            return
        }
    }

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
    'installer/configure.mjs' = 'be10058cd2fbe5634ec69d0099edb9587758c0b05d58261818635cf5b6f42d61'
    'installer/friendly.mjs' = '85a7972af7c1bf9ac4dbec6efd31f1d888a3c0da9044cc186d1aa8fed669750d'
    'installer/pi-friendly/bundle.json' = '675d83529ebed23b60e84cb6e4a336571a0e592fa9be2ca4fa800d24db5776b9'
    'installer/pi-friendly/activity.mjs' = '88e5d10d5f4058038744f5ed9787edc81bb2e0990288bfed172d4216f8d9fb8c'
    'installer/pi-friendly/buttons.mjs' = '3296455c173d266e8af49d542780a5c23afc8935d37b88380a82d0ecfecc67df'
    'installer/pi-friendly/clipboard.mjs' = 'fe40cdf182c2ca91e7513f2782dbb0e7e69bc989b0c3671260fe63bc9bd2b719'
    'installer/pi-friendly/errors.mjs' = '567914532d7fc26c9203fec036a87419f70b039e1b6e6e65e06edcdb0bf2c327'
    'installer/pi-friendly/exit-dialog.mjs' = '1d4fa0b3cd9b32b9d3b3825028e0202d53b91f39a57bd4876965317020605971'
    'installer/pi-friendly/folder-picker.mjs' = 'a992b884a104e02ea2c59fa1eece028f1d57b008e2a0bf8dca6e58a10d96e4e5'
    'installer/pi-friendly/friendly.mjs' = 'e2d9b08f20ae920b694269acd85c45510fe236ff05cbf8b5c1657ad3a2309b61'
    'installer/pi-friendly/hover.mjs' = 'b5cc892ce3a02282e20803a358759a785e8b024a6927c207eefacefafbc91f1d'
    'installer/pi-friendly/index.ts' = '8cd979f656bd8ed0772344088b25bdefbc1efa500999987b804cf9d5e2c26a5b'
    'installer/pi-friendly/LICENSE' = '94a5c5d74147e19c336747bda0baa9c923363cb3fac320f95743cba72a59d186'
    'installer/pi-friendly/menu.mjs' = 'a4e82e05c988c4d3635c4a3e0ef8aef3344e17c04d19f1c23f8edca1eb7bbad3'
    'installer/pi-friendly/model-preference.mjs' = '6e1376482dcd1893a8ad808f295e451bd49aca5df5ef75d285d1be168f0c132c'
    'installer/pi-friendly/mouse.mjs' = '6cafdb25d417a4ff3056e0a12c3b83750f7378bb290dd88e29ebaec86447d43f'
    'installer/pi-friendly/package.json' = '05e7ded88ec4b722ec026b4c75967cd26aa40b5000510a8093f6fad39afa454c'
    'installer/pi-friendly/project-form.mjs' = '9dc9c41756ad2d1b8f3912e493fc89e84242e9a39e63dec99339b2fc6d41acaf'
    'installer/pi-friendly/projects.mjs' = '60104d3681188fb5e04cab39d0a5e7478d75c91c4f01b55d4f05c2918392d717'
    'installer/pi-friendly/README.md' = 'bbc15f165120576b1e7f92ecc102570a1e7d1ee4a937c6fb285e10bf79d85fb9'
    'installer/pi-friendly/selection.mjs' = '7c6fe45e6afa0c4abd996352ae5a217e4fe9205efb097e0e2c8e2cea805110ca'
    'installer/pi-friendly/surface.mjs' = 'fcacd29a3859927367f887aa6c3784adb949c81f5f00c8638f812f3c9ce47951'
    'installer/pi-friendly/uploads.mjs' = '618b6823070e88c842fe6269f662e46e2bf16a61200ccfd32c9cb9bfd92a36c2'
    'installer/pi-friendly/voice-setup.mjs' = 'c545311ab52c4e1a09cf02662d6c2ae52e8561c0ad05fb6e96f87d83f32b988f'
    'installer/pi-friendly/voice.mjs' = 'eaf585368e2148fc2f36ff066f0b2d809a5224c0f323080712e45554b1f17bea'
    'installer/pi-friendly/voice_audio.py' = '659fdd63d58e4d6721ef64aba76ce91994e2704f8c7a0d73bfcc2bfecd762da6'
    'installer/pi-friendly/web/app.css' = '8006d53348d4c0a46b9bda22d9ee9c7644142951e1aaa8aedecccb14fc36b4ed'
    'installer/pi-friendly/web/app.js' = '30c087b459e0adec05ead8c9d317a67cb6a3e69fb20b56278995ee61585648f0'
    'installer/pi-friendly/web/index.html' = '4fdf949e51979357da980422bbaff37e418f29c317fbce603f013e498a358996'
    'installer/pi-friendly/web-host.mjs' = '3ea88db6f0ee9d65271d3060b1ac51b2d182b0502f4ae21092a1a6533376f5d5'
    'installer/pi-friendly/web-messages.mjs' = '10100e73c844cdcc750a7d0383424aeafb9f2a0dabc635b7e1839c50001b251d'
    'installer/pi-friendly/web-rpc.mjs' = '30c726753bec0cd74607cbd3251d8e7bfa981ba30ca237097477251b5760c792'
    'installer/pi-friendly/web-server.mjs' = '66c492ecb7a67e24b562507b9fb707d426638dd3cfdadcfd1c54b57c588239c7'
    'installer/pi-friendly/workspace.mjs' = '59d10621f26b7e9ac9f90073f686c5e4a9d084bd103afd8978eb6d19c7d4c568'
    'installer/pi-friendly/voice-worker.py' = '5e0119a3b732a70ca4019f9dea5c20802892d9b4f3af83750f096c457d94d55d'
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

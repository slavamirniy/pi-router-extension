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
$TaskSource = 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/b6e01e787aac664f891bf115de92df27470f3241'
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
    'installer/configure.mjs' = 'f971c96a5d8b4d133e9f20bba5fb4efb3c7aeb815f4a6cd1d9fc3982986f49fb'
    'installer/friendly.mjs' = 'bdccccf5f7a37200bc1d7737857fc3cd4241433bd56b5ffc2e6384c307b7543c'
    'installer/pi-friendly/bundle.json' = '1fd67ae0e94d930314b188fb2613c0cecdcd5940be74c19f9b3d5fca84b627f7'
    'installer/pi-friendly/LICENSE' = '7619509f890e5995b858f525a59dad4346b788c598db54b6ad8f4e51cda7c1bd'
    'installer/pi-friendly/activity.mjs' = 'a24f1ffbf7e53c3167a7fcbd0b93655ee63c46a3d506f41a8ed2fe4bdc93e3e3'
    'installer/pi-friendly/billing-panel.mjs' = 'd50c65b2a4334fc3a1ab7432f0b09ec02f03d6b789e2447236aaa64c538d05f8'
    'installer/pi-friendly/billing.mjs' = '8ab7983af2a91bf17fab15543ceaf16794b3030ee5b92bab9d45fec5ae0df6b2'
    'installer/pi-friendly/buttons.mjs' = 'db08e99863e394f573d40d2a3578b45a1eed5fa3ef255c6e0bf13ff1d8fe4993'
    'installer/pi-friendly/clipboard.mjs' = 'b46c0110745d169f4bab11b20f7c40dd82356476499ab39ebcb7983b42529aae'
    'installer/pi-friendly/errors.mjs' = '7c8dd4288b9153c89d21dd3f91902b8052a21421776e80b6b259c84e8d439f06'
    'installer/pi-friendly/exit-dialog.mjs' = '490c9ee135ea508c79bc671b3c92d89bd8b626bba960186e576c55b1a8d438d4'
    'installer/pi-friendly/folder-picker.mjs' = '0e1bbc47354a8c28e4f1bb08dab97bad39a3518f5b2e2c84dcd0ac2e3d6f5f4e'
    'installer/pi-friendly/friendly.mjs' = 'b0a81ed67b763c46985fa7444b0a1b1d77d1e6d7b88d526e2159d67a72666c5c'
    'installer/pi-friendly/hover.mjs' = '1e7a997b044de13322ef46b2332ed010c1e630ad161ef7bc3cd94b2bc5dcad48'
    'installer/pi-friendly/index.ts' = 'bcb1128593fe5c3855ce44ff4e8b2bb95b3bbd29123ed91118edc324fb9e0b5b'
    'installer/pi-friendly/legal.mjs' = '4863b553ef2e4ac9717093be4a42411522d15520a7d9e2d54a8ae66afe1dc938'
    'installer/pi-friendly/menu.mjs' = '9ca8cadc393640c5b8982db2348ed6afa188875d02b8e8fb9a5e1c5deb766c19'
    'installer/pi-friendly/model-picker.mjs' = 'b1780b708aea29663432a48b89401530e60b9016dc09a1227f960d65d586c689'
    'installer/pi-friendly/model-preference.mjs' = '11f3313f11cff5ebe8fe981855219de1c833100d3106c765308beec3d173f798'
    'installer/pi-friendly/mouse.mjs' = '4f5c6433c8a8cd97020364a0777e650edb8552b4a8f5fd8ad0c51d1651e258e0'
    'installer/pi-friendly/package.json' = '7b7437dc6e733c2468faa989453e9f454989b05695768238c54efbbfb74ecdee'
    'installer/pi-friendly/project-form.mjs' = 'b4a5b24dcceafebd0a5e2454a99cc0ce38a38f3082b395671d3c92a2f4958c57'
    'installer/pi-friendly/projects.mjs' = 'a20425991e8bd30722f5ed1258b63c71555a999ec171bb6d2c95afa5a5843e03'
    'installer/pi-friendly/router/LICENSE' = '7aeb0fefd5b229a189394de001b6125e3e59a43135647b82c74cf739ca38a710'
    'installer/pi-friendly/router/index.ts' = '386c717605f57f509ef78d23781f7d0801231435c18654522f5a9fa86aa0be56'
    'installer/pi-friendly/router/models.mjs' = 'fe484ac7229d50a343ec06e810bca31eba722abdb84d5bb803d8267839ffbe8a'
    'installer/pi-friendly/router/progress.mjs' = 'baca4338904c5050d16433d4ca83c6677775b1d9746cc599a42325695df191c0'
    'installer/pi-friendly/router/safety.mjs' = '76bdeccad825b281882456f7d69a7352b964f5df1dc6ab969b0b2301c2c135ba'
    'installer/pi-friendly/selection.mjs' = '38dfe2e4073550980a7b985e14e9a57ca16f0f8264ff4642578df3b8a077249a'
    'installer/pi-friendly/surface.mjs' = 'd56af4cdeb0afc5f7f198c4c2902004dcd606181d62780bccd291807661121ad'
    'installer/pi-friendly/uploads.mjs' = '618b6823070e88c842fe6269f662e46e2bf16a61200ccfd32c9cb9bfd92a36c2'
    'installer/pi-friendly/voice-setup.mjs' = 'd880ed57c78da937f911d7c62eefc71115f0daa21c373335f9cbb568ef29b900'
    'installer/pi-friendly/voice-worker.py' = 'fdec70d83c8a7d20a630cb0647e828157f6ce86767a3d566d97ed66e9288c44b'
    'installer/pi-friendly/voice.mjs' = '97078047307376099175b9fe984df4b2e212f7628ce0fab96169e65a27236b5d'
    'installer/pi-friendly/voice_audio.py' = '5dc8e5b2f236e6c32eee6c4aa6115f26e191929f31b9bd1e0a281f5d7306b70d'
    'installer/pi-friendly/web-host.mjs' = '858a9ce030934bddc4da6f88759137232eb8a334a9d8f42271e900318d35cb59'
    'installer/pi-friendly/web-messages.mjs' = '6677630d0619fa294f1a92373c20231d2b04ed234a5bb249620f416ab91a533b'
    'installer/pi-friendly/web-rpc.mjs' = '495309052bfc3016a397cb32da788968fc428bc6d9cad3e9bf9b1618458b857f'
    'installer/pi-friendly/web-server.mjs' = 'b252ac6ce715a1046f54523d6542acdd5a2f713e3876ce16c95b7bdc2e90576a'
    'installer/pi-friendly/web/app.css' = '721759701b842deebb2f49435694fca8f76a14f766a14f5f658c5dee845b07fb'
    'installer/pi-friendly/web/app.js' = 'e0b185bfdf1851f8e1162be07fdc1403841a27cf7e3d2809043d6a0dbc2e6275'
    'installer/pi-friendly/web/billing-ui.js' = 'be46e4f16ce5cdd0269c91948e31d41aca9583a448bce717f4e67c737d9365c9'
    'installer/pi-friendly/web/index.html' = '7d95459dd55ae5c50fd702a582cd9a300133e1fcbf5c638de674b172f38940a5'
    'installer/pi-friendly/workspace.mjs' = '25c252e02be2a8a7037d36854d6d3adcf0a833de637304e33ac9ee924a0d9329'
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

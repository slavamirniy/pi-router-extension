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
$TaskSource = 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/34a5482528526d6d06af964a2def8df846f6ba90'
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
    'installer/friendly.mjs' = '819bcc275aade2a62e817bb170f1640dac1935ad99d3125d6b8327f0c8d8b398'
    'installer/autoupdate/index.ts' = '80da32f295a23886f76b0ac0d2fd25c2662ce47ceca520bb8623d21be44ad856'
    'installer/autoupdate/update.mjs' = '7dc23c9ade8a379debe873aa230ae6890253ab90a29983f1f3640e73d17843ab'
    'installer/autoupdate/worker.mjs' = '069e1ca196a040236a6f77446058c0ceb0581d1677c546e179432c87ecc5bb44'
    'installer/autoupdate/trust.mjs' = 'af4d57b531555bd7102f1bf48dbbded9ad801a85cc9cb319d5e0c6b35859e07f'
    'installer/pi-friendly/bundle.json' = 'cca1378fefec939963c0bedafd39602f732bf82f541123d87158eb06a99419da'
    'installer/pi-friendly/LICENSE' = '7619509f890e5995b858f525a59dad4346b788c598db54b6ad8f4e51cda7c1bd'
    'installer/pi-friendly/activity.mjs' = '753079e60811b8d61986db4da0a973ea91ea2e6b446095656a1e9650bd345821'
    'installer/pi-friendly/billing-panel.mjs' = '626d873c355d466d45c33b190dabaeeae5c5dd7153195421336c292f7019abda'
    'installer/pi-friendly/billing.mjs' = '56f91c1bd5488043f69ba27f6620105aff9bcd397b704f0fc73ad14e8872c255'
    'installer/pi-friendly/browser-start.mjs' = '0d524fae8ca04affc5cf396d7903605397b4ebd46b388f397a6742baa7567133'
    'installer/pi-friendly/buttons.mjs' = 'db08e99863e394f573d40d2a3578b45a1eed5fa3ef255c6e0bf13ff1d8fe4993'
    'installer/pi-friendly/clipboard.mjs' = 'b46c0110745d169f4bab11b20f7c40dd82356476499ab39ebcb7983b42529aae'
    'installer/pi-friendly/errors.mjs' = '7c8dd4288b9153c89d21dd3f91902b8052a21421776e80b6b259c84e8d439f06'
    'installer/pi-friendly/exit-dialog.mjs' = '490c9ee135ea508c79bc671b3c92d89bd8b626bba960186e576c55b1a8d438d4'
    'installer/pi-friendly/folder-picker.mjs' = 'f4c3f6c8f6fee168b0f4aa17adfdac6b1f625853e31c7dd7bbf8cf03b90578fe'
    'installer/pi-friendly/friendly.mjs' = '59019385b3a76db2e17f5b2721dce5e6d3bd8d520727182c6b55f0b18742a39e'
    'installer/pi-friendly/hover.mjs' = '1e7a997b044de13322ef46b2332ed010c1e630ad161ef7bc3cd94b2bc5dcad48'
    'installer/pi-friendly/image-history.mjs' = '2fb235ca90ea47ed7dc7fdfa0aac09cc8699dd63e990c6862ba6235d3fc21a26'
    'installer/pi-friendly/image-tool.mjs' = '958bff597bb371eed6815a07dadcecf2b412714a72b213ea6a28b454a184f2ff'
    'installer/pi-friendly/index.ts' = '8c6f17ac1902639ef686a6bd18967595f65d66314bc6e470e2de14c1b018f054'
    'installer/pi-friendly/legal.mjs' = '4863b553ef2e4ac9717093be4a42411522d15520a7d9e2d54a8ae66afe1dc938'
    'installer/pi-friendly/menu.mjs' = '9ca8cadc393640c5b8982db2348ed6afa188875d02b8e8fb9a5e1c5deb766c19'
    'installer/pi-friendly/model-picker.mjs' = 'b1780b708aea29663432a48b89401530e60b9016dc09a1227f960d65d586c689'
    'installer/pi-friendly/model-preference.mjs' = '91ab8ecfa8c38ab0dc103fadd60de50993d435ebb77a38408a5eb5a220cfd2af'
    'installer/pi-friendly/mouse.mjs' = '4f5c6433c8a8cd97020364a0777e650edb8552b4a8f5fd8ad0c51d1651e258e0'
    'installer/pi-friendly/package.json' = '7c16382ddc97ec5028b4f3de8e3a121a89f53adf3439e40ad7230af781482210'
    'installer/pi-friendly/project-form.mjs' = '990d61dab347a589bfe9c6bdd5f066c082b1d02f1b1487f92d4e41df573bc6c0'
    'installer/pi-friendly/projects.mjs' = 'a20425991e8bd30722f5ed1258b63c71555a999ec171bb6d2c95afa5a5843e03'
    'installer/pi-friendly/router/LICENSE' = '7aeb0fefd5b229a189394de001b6125e3e59a43135647b82c74cf739ca38a710'
    'installer/pi-friendly/router/index.ts' = '386c717605f57f509ef78d23781f7d0801231435c18654522f5a9fa86aa0be56'
    'installer/pi-friendly/router/models.mjs' = 'c0d5032900db5e0e1870a81b7a2aff8d05d2ce60da49987aff8f006816a548a6'
    'installer/pi-friendly/router/progress.mjs' = 'baca4338904c5050d16433d4ca83c6677775b1d9746cc599a42325695df191c0'
    'installer/pi-friendly/router/safety.mjs' = '76bdeccad825b281882456f7d69a7352b964f5df1dc6ab969b0b2301c2c135ba'
    'installer/pi-friendly/selection.mjs' = '38dfe2e4073550980a7b985e14e9a57ca16f0f8264ff4642578df3b8a077249a'
    'installer/pi-friendly/subagents.mjs' = 'b6eab9cc8826cd63886711edef8296910b5c57356eb49c3888687356cdee16ed'
    'installer/pi-friendly/subagents/agents/planner.md' = '55265d3aec094332584b1a9e8d89a73f79edc6ed11ad487df40f3639f9fd5943'
    'installer/pi-friendly/subagents/agents/reviewer.md' = '42cb070abddf2eafa4a48cbecdc6db5ecd05945a6acb07759fe9fbcb61f670a0'
    'installer/pi-friendly/subagents/agents/scout.md' = '0459a65d4262abb60dbee0fba3618e458493d96158085bb64221e228cb548a51'
    'installer/pi-friendly/subagents/agents/worker.md' = '62f4ec4cff4ca9ca9ea70717e531cf23745a9425750ab581204bae740317059d'
    'installer/pi-friendly/surface.mjs' = '042c5b5cf9f46d62e9e0d71aa5461033d030e4b60aaaa4fe1a44e480adaf247e'
    'installer/pi-friendly/text-history.mjs' = '3007dd28d2aa245606e1c3a368a20c56ce1744693b642846b7b4acd633977f3e'
    'installer/pi-friendly/title.mjs' = '3e7cb5a72b8a53c75cf4a8f251a586abbc66d4c6e57d99ce0e3bd91b786bb94a'
    'installer/pi-friendly/uploads.mjs' = '618b6823070e88c842fe6269f662e46e2bf16a61200ccfd32c9cb9bfd92a36c2'
    'installer/pi-friendly/voice-setup.mjs' = 'd880ed57c78da937f911d7c62eefc71115f0daa21c373335f9cbb568ef29b900'
    'installer/pi-friendly/voice-worker.py' = 'fdec70d83c8a7d20a630cb0647e828157f6ce86767a3d566d97ed66e9288c44b'
    'installer/pi-friendly/voice.mjs' = '97078047307376099175b9fe984df4b2e212f7628ce0fab96169e65a27236b5d'
    'installer/pi-friendly/voice_audio.py' = '5dc8e5b2f236e6c32eee6c4aa6115f26e191929f31b9bd1e0a281f5d7306b70d'
    'installer/pi-friendly/web-host.mjs' = '3c01f338d3dc6e4f90be04c367e47d0936bfda0fe8e4d2efee894d0d250b61a0'
    'installer/pi-friendly/web-messages.mjs' = '4e09bf061f9054b011bf73cd286237a10066a038b7c17a63096729a065cd2371'
    'installer/pi-friendly/web-rpc.mjs' = '7d71f7a85c630699db1fa26239e7a3f8794b22d258d9320ba844dff8b52cca16'
    'installer/pi-friendly/web-server.mjs' = '6bc3532a7385b951321a77568e6c86e7ee9d2921af3109faa6da725d4e369882'
    'installer/pi-friendly/web/ai-diy-32.png' = '5582abf160589de44d266d620a763090a55c111386ebd95d6a70170bf858d75a'
    'installer/pi-friendly/web/ai-diy-64.png' = '3f488b798cfc3e0d04443d9fffa8a9a3d3214ebf358065c0171fc3622e4a8938'
    'installer/pi-friendly/web/ai-diy.png' = 'ce353036890960615073158ff65bb5dc392104371e3110e3c1bb42c40f0c83dd'
    'installer/pi-friendly/web/app.css' = '4e28f37cd1cc7ca71e454b3df56d9b63850355881ac5cf9dbc2289da7678c9c2'
    'installer/pi-friendly/web/app.js' = '95c886e57c191289f9e00972595022b1766c50e249d7ae268f6b61329c50c3d2'
    'installer/pi-friendly/web/attachments.js' = '49366bf020821f68ff0f96395d1f8c9e12d8d4b0a8075ecdf65561a095ec8d5e'
    'installer/pi-friendly/web/billing-ui.js' = '908cdbe3cbb94fa2eb6e3ab8c1c5d22c92d176644ebc45f6e7743639fca2cf17'
    'installer/pi-friendly/web/brand-icon.js' = '4809f703f88e4dc555ee9bf075f1e014a50a23eb06049c7c74ae26b6039cb283'
    'installer/pi-friendly/web/chrome.js' = 'e330de585b937f1f7bb4389002bd4a4565b9d9b46400f54e776008cf8857dd76'
    'installer/pi-friendly/web/fonts/OFL-Geist-Mono.txt' = 'cc815ed4fc045f0e991abb10395b7932bd028c6a067deb13316d6002105074e6'
    'installer/pi-friendly/web/fonts/OFL-Geist.txt' = '71609cbb5c78b5870d712eab73a31d76622635c6ed034ab5cee3b9ecbda8685f'
    'installer/pi-friendly/web/fonts/geist-cyrillic.woff2' = '6894439694946a589d157ece003086960a6a4013d74a813dab7602efdb3d8c09'
    'installer/pi-friendly/web/fonts/geist-latin.woff2' = '19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1'
    'installer/pi-friendly/web/fonts/geist-mono-cyrillic.woff2' = '4866787fc952dbdbd591d6923d67bc21c2d894b93f34ab69d0cdf25d47bfb2df'
    'installer/pi-friendly/web/fonts/geist-mono-latin.woff2' = '684ad5b531f81d43c1e8c7038262d5db7cdc1f68006e04d6c7769efa8d33c8cc'
    'installer/pi-friendly/web/index.html' = '8556050fc1482db2266b4cd7d4289cbd16f332283e01e73c923cc9b7307c27fe'
    'installer/pi-friendly/web/message-versions.js' = 'b6648f6b4ba3968a4d0df0ba06ba27135581cbfbaf4d828c1299fdf6b4f1a7fa'
    'installer/pi-friendly/web/onboarding.js' = '69954d60f5549bd20062f05f5fbda253d446a4bcc1de3df3cab99a06c222a7da'
    'installer/pi-friendly/web/sounds/done.mp3' = 'cfe22294469460f0cef050cbf533c8f66074cc8e63982d7ec0bbb3d2f7b57ab4'
    'installer/pi-friendly/workspace.mjs' = 'd08cbc9e280207dcf05ba038cd164823ab292b3213599423984736b9dc3c2941'
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
    $taskLink = $taskShell.CreateShortcut((Join-Path $taskDesktop 'AI DIY.lnk'))
    $taskLink.TargetPath = $env:ComSpec
    $taskLink.Arguments = '/d /c ""' + $taskLauncher + '""'
    $taskLink.WorkingDirectory = $taskProjects
    $taskLink.IconLocation = $taskIcon + ',0'
    $taskLink.Description = 'AI DIY'
    $taskLink.Save()
    $taskLegacyLink = Join-Path $taskDesktop 'AI своими руками.lnk'
    if (Test-Path -LiteralPath $taskLegacyLink) {
        $taskOldLink = $taskShell.CreateShortcut($taskLegacyLink)
        if ($taskOldLink.TargetPath -eq $taskLink.TargetPath -and $taskOldLink.Arguments -eq $taskLink.Arguments) {
            Remove-Item -LiteralPath $taskLegacyLink
        }
    }
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

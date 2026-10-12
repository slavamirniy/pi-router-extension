# Public interactive entry point. The release builder embeds the verified installer below.
# This URL installs Pi with AI DIY extensions; it does not install OpenCode.
function Start-AIDiyInstall {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $taskPreviousEnvironment = @{}
    foreach ($name in @('PI_API_KEY', 'PI_BASE_URL', 'PI_DEFAULT_MODEL')) {
        $taskPreviousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $taskAccessKey = $null
    $taskSecureKey = $null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Write-Host 'AI DIY - Pi with interface, models and quota' -ForegroundColor Cyan
# __PERSONAL_CONFIGURATION__
        if (!$taskAccessKey) {
            Write-Host 'Copy your access key from the Telegram bot and paste it below.'
            Write-Host 'The key is hidden while you type or paste. Then press Enter.'
            $taskSecureKey = Read-Host 'API key' -AsSecureString
            $taskKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecureKey)
            try { $taskAccessKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskKeyPointer).Trim() }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskKeyPointer) }
        }
        if ($taskAccessKey.Length -lt 10 -or $taskAccessKey.Length -gt 1024 -or $taskAccessKey -match '\s') {
            throw 'Invalid key. Copy the complete access key from the bot.'
        }
        $env:PI_API_KEY = $taskAccessKey
        if (!$env:PI_BASE_URL) { $env:PI_BASE_URL = 'https://aipipego.com/v1' }
        if (!$env:PI_DEFAULT_MODEL) { $env:PI_DEFAULT_MODEL = 'kimi-k3' }
        & {
# __VERIFIED_WINDOWS_INSTALLER__
        }
    } catch {
        $taskMessage = $_.Exception.Message
        if ($taskAccessKey) { $taskMessage = $taskMessage.Replace($taskAccessKey, '[KEY]') }
        Write-Host ('Installation stopped: ' + $taskMessage) -ForegroundColor Red
        Write-Host 'Send the error text to @themousekeeper. Do not send your access key.'
        Read-Host 'Press Enter to close' | Out-Null
        throw 'AI DIY installation did not finish.'
    } finally {
        foreach ($name in $taskPreviousEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $taskPreviousEnvironment[$name], 'Process')
        }
        if ($taskSecureKey) { $taskSecureKey.Dispose() }
        $taskAccessKey = $null
    }
}
Start-AIDiyInstall

# Short entry point usable from both CMD and PowerShell.
function Install-Pi {
    param(
        [Parameter(Mandatory=$true, Position=0)][string]$Key,
        [Parameter(Mandatory=$true, Position=1)][string]$Base,
        [Parameter(Position=2)][string]$Model = 'kimi-k3'
    )
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $OutputEncoding
    [Console]::InputEncoding = $OutputEncoding
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $env:PI_API_KEY = $Key
    $env:PI_BASE_URL = $Base
    $env:PI_DEFAULT_MODEL = $Model
    try {
        $TaskInstaller = $null
        for ($TaskAttempt = 1; $TaskAttempt -le 3; $TaskAttempt++) {
            try {
                $TaskInstaller = Invoke-RestMethod 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/v1.0.10/installer/install-pi-windows.ps1' -TimeoutSec 30
                break
            } catch {
                if ($TaskAttempt -eq 3) { throw 'Could not download installer. Check your internet connection and retry.' }
                Start-Sleep -Seconds 2
            }
        }
        Invoke-Expression $TaskInstaller
    } catch {
        $TaskError = $_.Exception.Message.Replace($Key, '[KEY]')
        Write-Host "Installation failed: $TaskError" -ForegroundColor Red
        Write-Host 'Copy this error text and send it to support. Your projects were not deleted.'
        throw 'Pi installation did not finish.'
    } finally {
        Remove-Item Env:PI_API_KEY,Env:PI_BASE_URL,Env:PI_DEFAULT_MODEL -ErrorAction SilentlyContinue
    }
}

# Short entry point usable from both CMD and PowerShell.
function Install-Pi {
    param(
        [Parameter(Mandatory=$true, Position=0)][string]$Key,
        [Parameter(Mandatory=$true, Position=1)][string]$Base,
        [Parameter(Position=2)][string]$Model = 'kimi-k3'
    )
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $env:PI_API_KEY = $Key
    $env:PI_BASE_URL = $Base
    $env:PI_DEFAULT_MODEL = $Model
    try {
        Invoke-RestMethod 'https://raw.githubusercontent.com/slavamirniy/pi-router-extension/v1.0.5/installer/install-pi-windows.ps1' | Invoke-Expression
    } finally {
        Remove-Item Env:PI_API_KEY,Env:PI_BASE_URL,Env:PI_DEFAULT_MODEL -ErrorAction SilentlyContinue
    }
}

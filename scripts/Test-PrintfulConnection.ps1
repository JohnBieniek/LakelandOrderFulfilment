[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$token = $env:Providers__Printful__ApiToken
if ([string]::IsNullOrWhiteSpace($token)) {
    $secureToken = Read-Host 'Printful store-scoped private token (hidden)' -AsSecureString
    $credential = [System.Net.NetworkCredential]::new('', $secureToken)
    $token = $credential.Password
}
try {
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'A Printful token is required.' }
    $response = Invoke-RestMethod -Uri 'https://api.printful.com/stores' -Method Get `
        -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 30
    $stores = @($response.result)
    if ($stores.Count -ne 1) {
        throw 'Expected one store. Create a private token with access to a single store.'
    }
    $stores | Select-Object id, name, type
    Write-Host 'Connection verified. Confirm this is your intended Manual Order/API store. No orders were created.'
}
catch {
    # Avoid echoing HTTP request details or credentials in an error record.
    throw 'Printful connection check failed. Check the token, single-store access, and network connectivity.'
}
finally {
    $token = $null
    $credential = $null
    if ($secureToken) { $secureToken.Dispose() }
}

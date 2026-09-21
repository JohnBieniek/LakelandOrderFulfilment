[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$RegistryName,
    [Parameter(Mandatory)][string]$ContainerEnvironmentName,
    [string]$Repository = 'JohnBieniek/LakelandOrderFulfilment'
)
$ErrorActionPreference = 'Stop'
function Assert-NativeSuccess { if ($LASTEXITCODE -ne 0) { throw 'A deployment command failed. Deployment stopped.' } }
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    $branch = git branch --show-current
    if ($branch -ne 'develop') { throw 'Run this deployment from the develop branch.' }
    if (git status --porcelain) { throw 'Commit changes before deploying so the image matches a reviewable commit.' }
    $revision = git rev-parse HEAD
    $account = az account show --output json | ConvertFrom-Json
    Assert-NativeSuccess
    az acr build --registry $RegistryName --image "lakeland-beta:$revision" --file Dockerfile . --no-logs
    Assert-NativeSuccess
    az deployment group create --resource-group $ResourceGroup --name lakeland-beta --template-file infra/beta.bicep `
        --parameters "containerEnvironmentName=$ContainerEnvironmentName" "registryName=$RegistryName" "imageTag=$revision" --output none
    Assert-NativeSuccess

    # This identity may update the beta app and push images, but has no production-app or database permissions.
    $identity = az identity create --name id-lakeland-beta-deploy --resource-group $ResourceGroup --output json | ConvertFrom-Json
    Assert-NativeSuccess
    $appId = az containerapp show --name ca-lakeland-beta --resource-group $ResourceGroup --query id --output tsv
    Assert-NativeSuccess
    $registryId = az acr show --name $RegistryName --query id --output tsv
    Assert-NativeSuccess
    $runtimeIdentityId = az identity show --name id-lakeland-beta-app --resource-group $ResourceGroup --query id --output tsv
    Assert-NativeSuccess
    foreach ($grant in @(
        @{ Role = 'Contributor'; Scope = $appId },
        @{ Role = 'AcrPush'; Scope = $registryId },
        @{ Role = 'Managed Identity Operator'; Scope = $runtimeIdentityId }
    )) {
        az role assignment create --assignee-object-id $identity.principalId --assignee-principal-type ServicePrincipal --role $grant.Role --scope $grant.Scope --output none
        Assert-NativeSuccess
    }
    az identity federated-credential create --name github-develop --identity-name id-lakeland-beta-deploy --resource-group $ResourceGroup `
        --issuer 'https://token.actions.githubusercontent.com' --subject "repo:${Repository}:environment:development" --audiences 'api://AzureADTokenExchange' --output none
    Assert-NativeSuccess
    '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' | gh api --method PUT "repos/$Repository/environments/development" --input - --silent
    Assert-NativeSuccess
    '{"name":"develop","type":"branch"}' | gh api --method POST "repos/$Repository/environments/development/deployment-branch-policies" --input - --silent
    Assert-NativeSuccess
    gh variable set AZURE_RESOURCE_GROUP --repo $Repository --env development --body $ResourceGroup
    Assert-NativeSuccess
    gh variable set AZURE_CONTAINER_REGISTRY --repo $Repository --env development --body $RegistryName
    Assert-NativeSuccess
    $identity.clientId | gh secret set AZURE_CLIENT_ID --repo $Repository --env development
    Assert-NativeSuccess
    $account.tenantId | gh secret set AZURE_TENANT_ID --repo $Repository --env development
    Assert-NativeSuccess
    $account.id | gh secret set AZURE_SUBSCRIPTION_ID --repo $Repository --env development
    Assert-NativeSuccess
    gh variable set BETA_DEPLOY_ENABLED --repo $Repository --body true
    Assert-NativeSuccess
    $hostName = az containerapp show --name ca-lakeland-beta --resource-group $ResourceGroup --query properties.configuration.ingress.fqdn --output tsv
    Assert-NativeSuccess
    Write-Host "Beta deployed: https://$hostName"
    Write-Host 'Future pushes to develop deploy automatically after CI passes. Checkout remains disabled in preview mode.'
}
finally { Pop-Location }

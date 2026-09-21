targetScope = 'resourceGroup'

@description('Existing Container Apps environment shared for compute; beta runs in its own app.')
param containerEnvironmentName string
param registryName string
param imageTag string
param location string = resourceGroup().location

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = { name: containerEnvironmentName }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: registryName }
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = { name: 'id-lakeland-beta-app', location: location }
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource beta 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-lakeland-beta'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
    }
    template: {
      containers: [{
        name: 'storefront'
        image: '${registry.properties.loginServer}/lakeland-beta:${imageTag}'
        env: [
          { name: 'ASPNETCORE_ENVIRONMENT', value: 'Beta' }
          { name: 'Storefront__Enabled', value: 'true' }
          { name: 'Storefront__PreviewOnly', value: 'true' }
          { name: 'Database__ApplyMigrations', value: 'false' }
        ]
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        probes: [{ type: 'Liveness', httpGet: { path: '/health', port: 8080, scheme: 'HTTP' }, initialDelaySeconds: 15, periodSeconds: 30 }]
      }]
      scale: { minReplicas: 0, maxReplicas: 1 }
    }
  }
  dependsOn: [pull]
}

output url string = 'https://${beta.properties.configuration.ingress.fqdn}'

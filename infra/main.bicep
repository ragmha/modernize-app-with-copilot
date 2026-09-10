targetScope = 'resourceGroup'

@description('Region explicitly selected by the learner; no automatic region fallback.')
param location string

@description('GitHub owner/repository, used for lab ownership tags.')
param repository string

@description('Object ID of the deployment service principal, NOT its client/application ID.')
param deploymentPrincipalId string

@secure()
@minLength(16)
param sqlAdminPassword string

@secure()
@minLength(16)
param postgresAdminPassword string

var suffix = uniqueString(resourceGroup().id, repository)
var tags = {
  lab: 'modernize-app-with-copilot'
  repository: repository
}
var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var acrPushRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8311e382-0749-4cb8-b61a-304f252e45ec')
var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: 'acr${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
    roleAssignmentMode: 'LegacyRegistryPermissions'
    policies: {
      azureADAuthenticationAsArmPolicy: {
        status: 'enabled'
      }
    }
  }
}

resource dotnetIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-dotnet-${suffix}'
  location: location
  tags: tags
}

resource javaIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-java-${suffix}'
  location: location
  tags: tags
}

resource dotnetPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, dotnetIdentity.id, acrPullRole)
  scope: registry
  properties: {
    principalId: dotnetIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
  }
}

resource javaPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, javaIdentity.id, acrPullRole)
  scope: registry
  properties: {
    principalId: javaIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
  }
}

resource deploymentPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, deploymentPrincipalId, acrPushRole)
  scope: registry
  properties: {
    principalId: deploymentPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPushRole
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-${suffix}'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.42.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'container-apps'
        properties: {
          addressPrefix: '10.42.0.0/23'
          delegations: [
            {
              name: 'container-apps'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: '10.42.2.0/27'
          delegations: [
            {
              name: 'postgres'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
          serviceEndpoints: [
            {
              service: 'Microsoft.Storage'
            }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: '10.42.3.0/27'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'logs-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: 1
    }
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: 'cae-${suffix}'
  location: location
  tags: tags
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
    vnetConfiguration: {
      infrastructureSubnetId: '${vnet.id}/subnets/container-apps'
      internal: false
    }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource sql 'Microsoft.Sql/servers@2023-08-01' = {
  name: 'sql-${suffix}'
  location: location
  tags: tags
  properties: {
    administratorLogin: 'labadmin'
    administratorLoginPassword: sqlAdminPassword
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Disabled'
  }
}

resource sqlConnectionPolicy 'Microsoft.Sql/servers/connectionPolicies@2023-08-01' = {
  parent: sql
  name: 'default'
  properties: {
    connectionType: 'Proxy'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sql
  name: 'photoalbum'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    maxSizeBytes: 2147483648
    requestedBackupStorageRedundancy: 'Local'
  }
}

module sqlEndpoint 'private-endpoint.bicep' = {
  name: 'sql-private-endpoint'
  params: {
    name: 'pe-sql-${suffix}'
    location: location
    tags: tags
    targetResourceId: sql.id
    groupId: 'sqlServer'
    dnsZoneName: 'privatelink${environment().suffixes.sqlServerHostname}'
    subnetId: '${vnet.id}/subnets/private-endpoints'
    virtualNetworkId: vnet.id
  }
}

resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'modernize.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresDns
  name: 'lab-vnet'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'pg-${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'labadmin'
    administratorLoginPassword: postgresAdminPassword
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    storage: {
      storageSizeGB: 32
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: '${vnet.id}/subnets/postgres'
      privateDnsZoneArmResourceId: postgresDns.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [
    postgresDnsLink
  ]
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'photoalbum'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'None'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource photos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'photos'
  properties: {
    publicAccess: 'None'
  }
}

resource blobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(photos.id, dotnetIdentity.id, blobContributorRole)
  scope: photos
  properties: {
    principalId: dotnetIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRole
  }
}

module blobEndpoint 'private-endpoint.bicep' = {
  name: 'blob-private-endpoint'
  params: {
    name: 'pe-blob-${suffix}'
    location: location
    tags: tags
    targetResourceId: storage.id
    groupId: 'blob'
    dnsZoneName: 'privatelink.blob.${environment().suffixes.storage}'
    subnetId: '${vnet.id}/subnets/private-endpoints'
    virtualNetworkId: vnet.id
  }
}

output foundation object = {
  registryName: registry.name
  registryLoginServer: registry.properties.loginServer
  environmentName: containerEnvironment.name
  dotnetIdentityName: dotnetIdentity.name
  javaIdentityName: javaIdentity.name
  sqlServerName: sql.name
  sqlDatabaseName: sqlDatabase.name
  postgresServerName: postgres.name
  postgresDatabaseName: postgresDatabase.name
  blobAccountName: storage.name
  blobContainerName: photos.name
  dotnetAppName: 'ca-dotnet-${suffix}'
  javaAppName: 'ca-java-${suffix}'
}

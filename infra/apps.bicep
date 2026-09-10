targetScope = 'resourceGroup'

param location string
param repository string
param foundation object
param sourceSha string
param revisionSuffix string
param allowedCidr string
param dotnetImage string
param javaImage string

@secure()
param sqlAdminPassword string

@secure()
param postgresAdminPassword string

@secure()
param dotnetAdminPassword string

@secure()
param javaAdminPassword string

var tags = {
  lab: 'modernize-app-with-copilot'
  repository: repository
  sourceSha: sourceSha
}
var ingress = {
  external: true
  allowInsecure: false
  targetPort: 8080
  transport: 'http'
  ipSecurityRestrictions: [
    {
      name: 'learner'
      description: 'Explicit learner public egress CIDR; all other addresses denied.'
      action: 'Allow'
      ipAddressRange: allowedCidr
    }
  ]
}
var probes = [
  {
    type: 'Startup'
    httpGet: {
      path: '/health'
      port: 8080
      scheme: 'HTTP'
    }
    initialDelaySeconds: 10
    // The Container Apps API caps failureThreshold at 10; retain a ten-minute startup window.
    periodSeconds: 60
    timeoutSeconds: 5
    failureThreshold: 10
  }
  {
    type: 'Readiness'
    httpGet: {
      path: '/health'
      port: 8080
      scheme: 'HTTP'
    }
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 3
  }
]
var scale = {
  minReplicas: 0
  maxReplicas: 1
  cooldownPeriod: 300
  rules: [
    {
      name: 'http'
      http: {
        metadata: {
          concurrentRequests: '10'
        }
      }
    }
  ]
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: foundation.environmentName
}

resource dotnetIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: foundation.dotnetIdentityName
}

resource javaIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: foundation.javaIdentityName
}

resource sql 'Microsoft.Sql/servers@2023-08-01' existing = {
  name: foundation.sqlServerName
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: foundation.postgresServerName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: foundation.blobAccountName
}

resource dotnet 'Microsoft.App/containerApps@2025-01-01' = {
  name: foundation.dotnetAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${dotnetIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 2
      ingress: ingress
      registries: [
        {
          server: foundation.registryLoginServer
          identity: dotnetIdentity.id
        }
      ]
      secrets: [
        {
          name: 'sql-connection'
          value: 'Server=tcp:${sql.properties.fullyQualifiedDomainName},1433;Initial Catalog=${foundation.sqlDatabaseName};User ID=labadmin;Password="${replace(sqlAdminPassword, '"', '""')}";Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
        }
        {
          name: 'admin-password'
          value: dotnetAdminPassword
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'photoalbum'
          image: dotnetImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          probes: probes
          env: [
            {
              name: 'ASPNETCORE_URLS'
              value: 'http://+:8080'
            }
            {
              name: 'ASPNETCORE_ENVIRONMENT'
              value: 'Production'
            }
            {
              name: 'ASPNETCORE_FORWARDEDHEADERS_ENABLED'
              value: 'true'
            }
            {
              name: 'ConnectionStrings__DefaultConnection'
              secretRef: 'sql-connection'
            }
            {
              name: 'Admin__Username'
              value: 'admin'
            }
            {
              name: 'Admin__Password'
              secretRef: 'admin-password'
            }
            {
              name: 'BlobStorage__ServiceUri'
              value: storage.properties.primaryEndpoints.blob
            }
            {
              name: 'BlobStorage__ContainerName'
              value: foundation.blobContainerName
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: dotnetIdentity.properties.clientId
            }
            {
              name: 'MODERNIZE_SOURCE_SHA'
              value: sourceSha
            }
          ]
        }
      ]
      scale: scale
    }
  }
}

resource java 'Microsoft.App/containerApps@2025-01-01' = {
  name: foundation.javaAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${javaIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 2
      ingress: ingress
      registries: [
        {
          server: foundation.registryLoginServer
          identity: javaIdentity.id
        }
      ]
      secrets: [
        {
          name: 'postgres-password'
          value: postgresAdminPassword
        }
        {
          name: 'admin-password'
          value: javaAdminPassword
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      containers: [
        {
          name: 'photoalbum'
          image: javaImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: probes
          env: [
            {
              name: 'SERVER_PORT'
              value: '8080'
            }
            {
              name: 'SPRING_PROFILES_ACTIVE'
              value: 'docker'
            }
            {
              name: 'SERVER_FORWARD_HEADERS_STRATEGY'
              value: 'framework'
            }
            {
              name: 'SPRING_DATASOURCE_URL'
              value: 'jdbc:postgresql://${postgres.properties.fullyQualifiedDomainName}:5432/${foundation.postgresDatabaseName}?sslmode=verify-full&sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory'
            }
            {
              name: 'SPRING_DATASOURCE_USERNAME'
              value: 'labadmin'
            }
            {
              name: 'SPRING_DATASOURCE_PASSWORD'
              secretRef: 'postgres-password'
            }
            {
              name: 'SPRING_DATASOURCE_DRIVER_CLASS_NAME'
              value: 'org.postgresql.Driver'
            }
            {
              name: 'SPRING_JPA_DATABASE_PLATFORM'
              value: 'org.hibernate.dialect.PostgreSQLDialect'
            }
            {
              name: 'SPRING_JPA_HIBERNATE_DDL_AUTO'
              value: 'validate'
            }
            {
              name: 'SPRING_JPA_SHOW_SQL'
              value: 'false'
            }
            {
              name: 'LOGGING_LEVEL_ORG_HIBERNATE_SQL'
              value: 'WARN'
            }
            {
              name: 'APP_ADMIN_USERNAME'
              value: 'admin'
            }
            {
              name: 'APP_ADMIN_PASSWORD'
              secretRef: 'admin-password'
            }
            {
              name: 'JAVA_TOOL_OPTIONS'
              value: '-XX:MaxRAMPercentage=65 -XX:+ExitOnOutOfMemoryError'
            }
            {
              name: 'MODERNIZE_SOURCE_SHA'
              value: sourceSha
            }
          ]
        }
      ]
      scale: scale
    }
  }
}

output dotnetUrl string = 'https://${dotnet.properties.configuration.ingress.fqdn}'
output javaUrl string = 'https://${java.properties.configuration.ingress.fqdn}'

import type {
  ApplicationAddress,
  ApplicationDiscoveryRecord,
  ApplicationEnvelope,
  ApplicationIntegrationDescriptor,
  ApplicationAdapterManifest,
} from '@infos/shared'

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

export function validateApplicationDescriptor(
  value: ApplicationIntegrationDescriptor,
): ApplicationIntegrationDescriptor {
  if (value.protocolVersion !== 1) throw new Error('APPLICATION_PROTOCOL_UNSUPPORTED')
  requireIdentifier(value.appId, 'APPLICATION_APP_ID_INVALID')
  requireIdentifier(value.instanceId, 'APPLICATION_INSTANCE_ID_INVALID')
  if (!value.name.trim()) throw new Error('APPLICATION_NAME_REQUIRED')
  if (!value.appVersion.trim()) throw new Error('APPLICATION_VERSION_REQUIRED')
  if (!value.adapterVersion.trim()) throw new Error('APPLICATION_ADAPTER_VERSION_REQUIRED')
  const endpointIds = new Set<string>()
  for (const endpoint of value.endpoints) {
    requireIdentifier(endpoint.endpointId, 'APPLICATION_ENDPOINT_ID_INVALID')
    if (endpointIds.has(endpoint.endpointId)) throw new Error('APPLICATION_ENDPOINT_DUPLICATED')
    endpointIds.add(endpoint.endpointId)
    if (!endpoint.version.trim()) throw new Error('APPLICATION_ENDPOINT_VERSION_REQUIRED')
    if (endpoint.operations.length === 0)
      throw new Error('APPLICATION_ENDPOINT_OPERATIONS_REQUIRED')
    const operations = new Set<string>()
    for (const operation of endpoint.operations) {
      requireIdentifier(operation, 'APPLICATION_OPERATION_INVALID')
      if (operations.has(operation)) throw new Error('APPLICATION_OPERATION_DUPLICATED')
      operations.add(operation)
    }
  }
  return value
}

export function defineApplicationAdapter<T extends ApplicationAdapterManifest>(manifest: T): T {
  if (manifest.manifestVersion !== 1 || manifest.protocolVersion !== 1) {
    throw new Error('APPLICATION_ADAPTER_PROTOCOL_UNSUPPORTED')
  }
  requireIdentifier(manifest.id, 'APPLICATION_ADAPTER_ID_INVALID')
  if (!manifest.name.trim() || !manifest.description.trim()) {
    throw new Error('APPLICATION_ADAPTER_METADATA_REQUIRED')
  }
  if (!manifest.adapterVersion.trim()) throw new Error('APPLICATION_ADAPTER_VERSION_REQUIRED')
  if (manifest.application.transports.length === 0) {
    throw new Error('APPLICATION_ADAPTER_TRANSPORT_REQUIRED')
  }
  validateApplicationDescriptor({
    protocolVersion: 1,
    appId: manifest.id,
    instanceId: 'manifest-validation',
    name: manifest.name,
    appVersion: 'manifest-validation',
    adapterVersion: manifest.adapterVersion,
    state: 'stopped',
    endpoints: manifest.endpoints,
  })
  const capabilities = new Set<string>()
  for (const requirement of manifest.requestedCapabilities) {
    requireIdentifier(requirement.capabilityType, 'APPLICATION_CAPABILITY_TYPE_INVALID')
    if (!requirement.contractVersion.trim() || !requirement.reason.trim()) {
      throw new Error('APPLICATION_CAPABILITY_METADATA_REQUIRED')
    }
    const key = `${requirement.capabilityType}@${requirement.contractVersion}`
    if (capabilities.has(key)) throw new Error('APPLICATION_CAPABILITY_DUPLICATED')
    capabilities.add(key)
  }
  return Object.freeze(manifest)
}

export function validateApplicationDiscovery(
  value: ApplicationDiscoveryRecord,
): ApplicationDiscoveryRecord {
  if (value.protocolVersion !== 1 || value.applicationProtocolVersion !== 1) {
    throw new Error('APPLICATION_DISCOVERY_PROTOCOL_UNSUPPORTED')
  }
  validateApplicationDescriptor(value.application)
  if (!Number.isInteger(value.pid) || value.pid <= 0) throw new Error('APPLICATION_PID_INVALID')
  if (!Number.isInteger(value.generation) || value.generation <= 0) {
    throw new Error('APPLICATION_GENERATION_INVALID')
  }
  const endpoint = new URL(value.endpoint)
  if (value.carrier !== 'websocket' || endpoint.protocol !== 'ws:') {
    throw new Error('APPLICATION_DISCOVERY_CARRIER_INVALID')
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
    throw new Error('APPLICATION_DISCOVERY_ENDPOINT_FORBIDDEN')
  }
  return value
}

export function validateApplicationEnvelope<T>(
  value: ApplicationEnvelope<T>,
): ApplicationEnvelope<T> {
  if (value.protocolVersion !== 1) throw new Error('APPLICATION_PROTOCOL_UNSUPPORTED')
  requireIdentifier(value.messageId, 'APPLICATION_MESSAGE_ID_INVALID')
  requireIdentifier(value.correlationId, 'APPLICATION_CORRELATION_ID_INVALID')
  requireAddress(value.source)
  requireAddress(value.target)
  requireIdentifier(value.operation, 'APPLICATION_OPERATION_INVALID')
  if (value.deadline && Number.isNaN(Date.parse(value.deadline))) {
    throw new Error('APPLICATION_DEADLINE_INVALID')
  }
  return value
}

function requireAddress(value: ApplicationAddress): void {
  requireIdentifier(value.appId, 'APPLICATION_APP_ID_INVALID')
  requireIdentifier(value.instanceId, 'APPLICATION_INSTANCE_ID_INVALID')
  if (value.endpoint) requireIdentifier(value.endpoint, 'APPLICATION_ENDPOINT_ID_INVALID')
}

function requireIdentifier(value: string, code: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) throw new Error(code)
}

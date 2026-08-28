import { randomUUID } from 'node:crypto'
import os from 'node:os'
import type {
  ApplicationIntegrationDescriptor,
  KernelCapabilityOffer,
  KernelNodeDescriptor,
  KernelNodeId,
  KernelObjectId,
} from '@infos/shared'
import type { NodeHelloMessage, NodeIdentityRecord, NodeProvider } from '@infos/node-sdk'
import { createEchoAssetProvider } from './echoAssetProvider'
import { createSystemShellProvider } from './systemShellProvider'
import { FileNodeIdentityStore } from './identity'
import { InMemoryNodeTransport } from './inMemoryTransport'
import { LoopbackWebSocketNodeServer } from './loopbackWebSocketTransport'
import { PersistentNodeTrustStore } from './trustStore'
import { SecureWebSocketNodeServer, type NodeTlsServerOptions } from './secureWebSocketTransport'
import { ChunkedNodeTransferRegistry } from './chunkedTransfer'
import { NodeProviderRuntime } from './providerRuntime'

export class NodeHost {
  readonly identity: NodeIdentityRecord
  readonly runtime: NodeProviderRuntime
  private wsServer?: LoopbackWebSocketNodeServer
  private secureServer?: SecureWebSocketNodeServer
  readonly trustStore?: PersistentNodeTrustStore
  readonly transfers = new ChunkedNodeTransferRegistry()

  constructor(input: {
    identityPath: string
    displayName?: string
    facets?: KernelNodeDescriptor['facets']
    trustPath?: string
    application?: ApplicationIntegrationDescriptor
  }) {
    this.identity = new FileNodeIdentityStore(input.identityPath).loadOrCreate({
      displayName: input.displayName ?? os.hostname(),
      facets: input.facets ?? ['capability', 'compute'],
      trust: 'untrusted',
      platform: {
        os:
          process.platform === 'win32'
            ? 'windows'
            : process.platform === 'darwin'
              ? 'macos'
              : process.platform === 'linux'
                ? 'linux'
                : 'unknown',
        arch: process.arch,
        runtime: process.versions.bun ? 'bun' : 'node',
        version: process.version,
      },
      protocolVersion: 1,
      registeredAt: new Date().toISOString(),
    })
    this.runtime = new NodeProviderRuntime(this.identity.descriptor)
    this.application = input.application
    this.trustStore = input.trustPath ? new PersistentNodeTrustStore(input.trustPath) : undefined
  }

  private application?: ApplicationIntegrationDescriptor

  register(provider: NodeProvider): () => void {
    return this.runtime.register(provider)
  }

  registerProbeProviders(): void {
    this.register(createEchoAssetProvider(this.identity.descriptor.nodeId))
  }

  registerSystemShellProvider(): void {
    this.register(createSystemShellProvider(this.identity.descriptor.nodeId))
  }

  async start(): Promise<void> {
    await this.runtime.start()
  }

  inMemoryTransport(localNodeId: KernelNodeId) {
    return new InMemoryNodeTransport(localNodeId, this.runtime)
  }

  async listenLoopback(port = 0): Promise<number> {
    if (this.wsServer) throw new Error('NODE_HOST_WS_ALREADY_RUNNING')
    this.wsServer = new LoopbackWebSocketNodeServer(this.runtime, this.hello())
    return this.wsServer.listen(port)
  }

  async listenSecure(options: NodeTlsServerOptions): Promise<number> {
    if (!this.trustStore) throw new Error('NODE_TRUST_STORE_REQUIRED')
    if (this.secureServer) throw new Error('NODE_HOST_WSS_ALREADY_RUNNING')
    this.secureServer = new SecureWebSocketNodeServer(this.runtime, this.hello(), this.trustStore)
    return this.secureServer.listen(options)
  }

  offers(): KernelCapabilityOffer[] {
    return this.runtime.listOffers().map((manifest) => ({
      ...manifest.offer,
      provider: {
        objectType: 'node-provider',
        objectId: `${this.identity.descriptor.nodeId}/${manifest.providerId}` as KernelObjectId,
        generation: 1,
        ownerPrincipalId: 'system',
        authorityNodeId: this.identity.descriptor.nodeId,
        authorityEpoch: 1,
      },
      health: 'available',
      placement: {
        providerNodeId: this.identity.descriptor.nodeId,
        providerFacet: 'capability',
        executionLocation: 'remote-capability-node',
        resourceAuthorityNodeId: this.identity.descriptor.nodeId,
        requiresClientPresence: false,
        requiresInputSeat: false,
        supportsHeadless: true,
        dataResidency: 'node-only',
        latencyClass: 'wan',
        costClass: 'metered',
      },
    }))
  }

  hello(): NodeHelloMessage {
    return {
      protocolVersion: 1,
      type: 'hello',
      messageId: randomUUID(),
      supportedVersions: [1],
      descriptor: this.identity.descriptor,
      certificate: this.identity.certificate,
      offers: this.offers(),
      application: this.application,
    }
  }

  diagnostics() {
    return {
      nodeId: this.identity.descriptor.nodeId,
      displayName: this.identity.descriptor.displayName,
      facets: this.identity.descriptor.facets,
      paired: Boolean(this.identity.certificate),
      providers: this.runtime.listOffers().map((manifest) => manifest.providerId),
      loopbackListening: Boolean(this.wsServer),
      secureListening: Boolean(this.secureServer),
      trustedNodes: this.trustStore?.list().length ?? 0,
    }
  }

  async stop(): Promise<void> {
    await this.wsServer?.close()
    await this.secureServer?.close()
    this.wsServer = undefined
    this.secureServer = undefined
    await this.runtime.stop()
  }
}

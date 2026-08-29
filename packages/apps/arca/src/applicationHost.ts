/**
 * applicationHost — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { KernelNodeId } from '@infos/shared'
import { NodeHost } from '@infos/node-host'
import {
  ArcaPortableProjectPackage,
  ContentAddressedBlobStore,
  SqliteDocumentEngine,
  type DocumentOutboxEvent,
} from '@infos/document-engine'
import { ArcaFederationState } from './federationState'
import { ArcaDocumentContextProvider } from './documentContextProvider'
import { SurfaceSessionManager } from './surfaceSession'
import { createDocumentCapabilityProvider } from './documentProvider'
import { ArcaModelRepository } from './modelRepository'
import { createModelCapabilityProvider } from './modelProvider'
import { ArcaDiscoveryStore, type ArcaDiscoveryRecord } from './discovery'
import { arcaAdapterManifest } from './adapterManifest'

export interface ArcaApplicationHostOptions {
  dataPath: string
  discoveryPath?: string
  displayName?: string
}

export class ArcaApplicationHost {
  readonly nodeHost: NodeHost
  readonly documents: SqliteDocumentEngine
  readonly blobs: ContentAddressedBlobStore
  readonly packages: ArcaPortableProjectPackage
  readonly discovery: ArcaDiscoveryStore
  readonly surfaceSessions = new SurfaceSessionManager()
  readonly models: ArcaModelRepository
  readonly documentContext: ArcaDocumentContextProvider
  readonly federation: ArcaFederationState
  readonly instanceId = randomUUID()
  private generation = 0
  private discoveryRecord?: ArcaDiscoveryRecord
  private started = false

  constructor(readonly options: ArcaApplicationHostOptions) {
    mkdirSync(options.dataPath, { recursive: true })
    this.nodeHost = new NodeHost({
      identityPath: path.join(options.dataPath, 'identity.json'),
      displayName: options.displayName ?? 'Arca',
      facets: ['application', 'capability', 'storage'],
      application: {
        protocolVersion: 1,
        appId: 'infos.arca',
        instanceId: this.instanceId,
        name: 'Arca',
        appVersion: '0.9.3-hotfix1',
        adapterVersion: '1.0.0',
        state: 'ready',
        endpoints: arcaAdapterManifest.endpoints,
      },
    })
    this.documents = new SqliteDocumentEngine(path.join(options.dataPath, 'arca.sqlite'))
    this.blobs = new ContentAddressedBlobStore(path.join(options.dataPath, 'blobs'))
    this.packages = new ArcaPortableProjectPackage(this.documents, this.blobs)
    this.models = new ArcaModelRepository(path.join(options.dataPath, 'model-authority'))
    this.documentContext = new ArcaDocumentContextProvider(this.nodeId, this.documents)
    this.federation = new ArcaFederationState(this.documents)
    this.discovery = new ArcaDiscoveryStore(
      options.discoveryPath ?? path.join(options.dataPath, 'runtime', 'discovery.json'),
    )
    this.nodeHost.register(
      createDocumentCapabilityProvider({
        nodeId: this.nodeId,
        engine: this.documents,
        blobs: this.blobs,
        sessions: this.surfaceSessions,
        contextProvider: this.documentContext,
        federation: this.federation,
        packages: this.packages,
      }),
    )
    this.nodeHost.register(
      createModelCapabilityProvider({
        nodeId: this.nodeId,
        models: this.models,
        sessions: this.surfaceSessions,
      }),
    )
  }

  get nodeId(): KernelNodeId {
    return this.nodeHost.identity.descriptor.nodeId
  }

  async start(input: { loopbackPort?: number } = {}): Promise<{ loopbackPort?: number }> {
    if (this.started) return {}
    await this.nodeHost.start()
    this.started = true
    if (input.loopbackPort === undefined) return {}
    const loopbackPort = await this.nodeHost.listenLoopback(input.loopbackPort)
    this.generation += 1
    this.discoveryRecord = this.discovery.publish({
      application: this.nodeHost.hello().application!,
      nodeId: this.nodeId,
      pid: process.pid,
      generation: this.generation,
      carrier: 'websocket',
      endpoint: `ws://127.0.0.1:${loopbackPort}`,
      startedAt: new Date().toISOString(),
    })
    return { loopbackPort }
  }

  diagnostics() {
    return {
      applicationId: 'infos.arca',
      state: this.started ? 'ready' : 'stopped',
      dataPath: this.options.dataPath,
      pendingOutbox: this.documents.listPendingOutbox().length,
      discovery: this.discoveryRecord,
      ...this.nodeHost.diagnostics(),
    }
  }

  async publishOutbox(
    publisher: (event: DocumentOutboxEvent) => Promise<void>,
    limit = 100,
  ): Promise<{ published: number; failedEventId?: string }> {
    let published = 0
    for (const event of this.documents.listPendingOutbox(limit)) {
      try {
        await publisher(event)
        this.documents.markOutboxPublished(event.eventId)
        published += 1
      } catch {
        return { published, failedEventId: event.eventId }
      }
    }
    return { published }
  }

  async stop(): Promise<void> {
    this.discovery.removeIfOwned(this.instanceId, this.generation)
    this.discoveryRecord = undefined
    if (!this.started) {
      this.documents.close()
      return
    }
    await this.nodeHost.stop()
    this.documents.close()
    this.started = false
  }
}

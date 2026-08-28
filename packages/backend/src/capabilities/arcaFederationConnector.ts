import { existsSync, readFileSync, rmSync } from 'node:fs'
import type { ApplicationDiscoveryRecord, KernelNodeId } from '@infos/shared'
import { LoopbackWebSocketNodeTransport } from '@infos/node-host'
import { validateApplicationDiscovery } from '@infos/node-sdk'
import type { CapabilityDirectory } from '../kernel/capabilityDirectory'
import { LifecycleScope } from '../kernel/lifecycleScope'
import { NodeCapabilityBridge } from '../kernel/nodeCapabilityBridge'
import type { NodeRegistry } from '../kernel/nodeRegistry'
import { createLogger } from '../lib/logger'

const logger = createLogger('ApplicationFederation')

type ApplicationDiscovery = ApplicationDiscoveryRecord

export class ApplicationFederationConnector {
  private scope?: LifecycleScope
  private timer?: NodeJS.Timeout
  private activeIdentity?: string
  private syncing = false
  private lastError?: string
  private lastConnectedAt?: string
  private discovery?: ApplicationDiscovery

  constructor(
    private readonly discoveryPath: string,
    private readonly localNodeId: KernelNodeId,
    private readonly directory: CapabilityDirectory,
    private readonly nodes: NodeRegistry,
    private readonly expectedAppId: string,
  ) {}

  status(): {
    state: 'offline' | 'connecting' | 'connected' | 'error'
    discoveryPath: string
    discovery?: ApplicationDiscovery
    lastConnectedAt?: string
    lastError?: string
  } {
    return {
      state: this.scope
        ? 'connected'
        : this.syncing
          ? 'connecting'
          : this.lastError
            ? 'error'
            : 'offline',
      discoveryPath: this.discoveryPath,
      discovery: this.discovery ? structuredClone(this.discovery) : undefined,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
    }
  }

  async reconnect(): Promise<void> {
    this.lastError = undefined
    this.activeIdentity = undefined
    await this.disconnect()
    await this.sync()
  }

  async disconnectCurrent(): Promise<void> {
    await this.disconnect()
  }

  start(intervalMs = 3_000): void {
    if (this.timer) return
    void this.sync()
    this.timer = setInterval(() => void this.sync(), intervalMs)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.disconnect()
  }

  private isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
  }

  private removeDiscoveryIfOwned(expected: ApplicationDiscovery): void {
    if (!existsSync(this.discoveryPath)) return
    try {
      const current = JSON.parse(readFileSync(this.discoveryPath, 'utf8')) as ApplicationDiscovery
      if (
        current.application.instanceId === expected.application.instanceId &&
        current.generation === expected.generation &&
        current.pid === expected.pid
      ) {
        rmSync(this.discoveryPath, { force: true })
      }
    } catch {
      // 损坏的Discovery同样不可用于连接。
      rmSync(this.discoveryPath, { force: true })
    }
  }

  private async sync(): Promise<void> {
    if (this.syncing) return
    this.syncing = true
    try {
      if (!existsSync(this.discoveryPath)) {
        this.discovery = undefined
        this.lastError = undefined
        if (this.scope) await this.disconnect()
        return
      }
      const record = validateApplicationDiscovery(
        JSON.parse(readFileSync(this.discoveryPath, 'utf8')) as ApplicationDiscovery,
      )
      if (!this.isProcessAlive(record.pid)) {
        logger.info(
          `清理陈旧Application Discovery: app=${record.application.appId}, pid=${record.pid}`,
        )
        rmSync(this.discoveryPath, { force: true })
        this.discovery = undefined
        this.lastError = undefined
        if (this.scope) await this.disconnect()
        return
      }
      this.discovery = record
      const identity = `${record.application.instanceId}:${record.generation}`
      if (identity === this.activeIdentity && this.scope) return
      await this.connect(record)
    } catch (error) {
      const failedDiscovery = this.discovery
      if (failedDiscovery) this.removeDiscoveryIfOwned(failedDiscovery)
      this.discovery = undefined
      this.lastError = error instanceof Error ? error.message : String(error)
      logger.warn(`Application Federation同步失败，已清理失效Discovery: ${error}`)
      await this.disconnect()
    } finally {
      this.syncing = false
    }
  }

  async connect(discovered?: ApplicationDiscovery): Promise<boolean> {
    if (!existsSync(this.discoveryPath) && !discovered) {
      logger.info(`Application未运行，跳过 Federation: ${this.discoveryPath}`)
      return false
    }
    const record =
      discovered ??
      validateApplicationDiscovery(
        JSON.parse(readFileSync(this.discoveryPath, 'utf8')) as ApplicationDiscovery,
      )
    if (!this.isProcessAlive(record.pid)) {
      rmSync(this.discoveryPath, { force: true })
      this.discovery = undefined
      return false
    }
    if (record.application.appId !== this.expectedAppId) {
      throw new Error('APPLICATION_DISCOVERY_APP_MISMATCH')
    }
    await this.disconnect()
    const scope = new LifecycleScope(
      `application-adapter:${record.application.appId}:${record.application.instanceId}:${record.generation}`,
    )
    const transport = new LoopbackWebSocketNodeTransport(this.localNodeId, record.endpoint)
    scope.defer(() => transport.close())
    const hello = await transport.waitForHello()
    if (hello.descriptor.nodeId !== record.nodeId) throw new Error('ARCA_DISCOVERY_NODE_MISMATCH')
    if (
      hello.application?.appId !== record.application.appId ||
      hello.application.instanceId !== record.application.instanceId
    ) {
      throw new Error('ARCA_APPLICATION_IDENTITY_MISMATCH')
    }
    this.nodes.registerNode(hello.descriptor)
    const session = this.nodes.connect({
      nodeId: hello.descriptor.nodeId,
      carrier: 'websocket',
      leaseMs: 86_400_000,
    })
    scope.defer(() => {
      this.nodes.disconnect(session.sessionId)
    })
    const bridge = new NodeCapabilityBridge(this.localNodeId, transport)
    for (const offer of hello.offers) {
      if (!this.directory.hasDefinition(offer.capabilityType, offer.contractVersion)) {
        scope.defer(
          this.directory.registerDefinition({
            capabilityType: offer.capabilityType,
            contractVersion: offer.contractVersion,
            operations: Object.fromEntries(
              offer.operations.map((operation) => [
                operation,
                { risk: 'interact' as const, idempotency: 'unsafe' as const },
              ]),
            ),
          }),
        )
      }
      const objectId = String(offer.provider.objectId)
      const prefix = `${hello.descriptor.nodeId}/`
      if (!objectId.startsWith(prefix))
        throw new Error(`APPLICATION_PROVIDER_ID_INVALID: ${objectId}`)
      const providerId = objectId.slice(prefix.length)
      bridge.register({
        directory: this.directory,
        offer,
        providerId,
        scope,
      })
    }
    this.scope = scope
    this.discovery = record
    this.lastError = undefined
    this.lastConnectedAt = new Date().toISOString()
    this.activeIdentity = `${record.application.instanceId}:${record.generation}`
    logger.info(
      `Application Federation已接入: app=${record.application.appId}, node=${record.nodeId}, offers=${hello.offers.length}`,
    )
    return true
  }

  async disconnect(): Promise<void> {
    const scope = this.scope
    this.scope = undefined
    this.activeIdentity = undefined
    await scope?.dispose()
  }
}

export class ArcaFederationConnector extends ApplicationFederationConnector {
  constructor(
    discoveryPath: string,
    localNodeId: KernelNodeId,
    directory: CapabilityDirectory,
    nodes: NodeRegistry,
  ) {
    super(discoveryPath, localNodeId, directory, nodes, 'infos.arca')
  }
}

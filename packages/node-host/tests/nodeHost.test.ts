import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { KernelEnvelope, KernelNodeId } from '@infos/shared'
import {
  createNodeAssetPayload,
  verifyNodeAssetPayload,
  type NodeInvokeRequest,
} from '@infos/node-sdk'
import {
  FileNodeIdentityStore,
  LoopbackWebSocketNodeTransport,
  NodeHost,
  PairingAuthority,
  PersistentNodeTrustStore,
  ChunkedNodeTransferRegistry,
} from '../src/index'

const roots: string[] = []
const serverId = 'server-node' as KernelNodeId

function root(): string {
  const value = path.join(tmpdir(), `infos-node-host-${randomUUID()}`)
  mkdirSync(value, { recursive: true })
  roots.push(value)
  return value
}

function request(
  nodeId: KernelNodeId,
  operation: string,
  input: unknown,
  options: { deadline?: string; idempotencyKey?: string; invocationId?: string } = {},
): NodeInvokeRequest {
  const invocationId = options.invocationId ?? randomUUID()
  const envelope: KernelEnvelope<{ operation: string; input: unknown }> = {
    protocolVersion: 1,
    messageId: randomUUID(),
    correlationId: invocationId,
    principalId: 'pero',
    operation: `probe.echo-asset/${operation}`,
    sourceNodeId: serverId,
    targetNodeId: nodeId,
    route: { sourceNodeId: serverId, targetNodeId: nodeId, hopLimit: 8 },
    deadline: options.deadline,
    idempotencyKey: options.idempotencyKey,
    emittedAt: new Date().toISOString(),
    durability: 'ephemeral',
    carrier: 'memory',
    payload: { operation, input },
  }
  return {
    protocolVersion: 1,
    type: 'invoke',
    messageId: randomUUID(),
    invocationId,
    sourceNodeId: serverId,
    targetNodeId: nodeId,
    providerId: 'infos.probe.echo-asset',
    envelope,
  }
}

function shellRequest(nodeId: KernelNodeId, operation: string, input: unknown): NodeInvokeRequest {
  const invocationId = randomUUID()
  return {
    protocolVersion: 1,
    type: 'invoke',
    messageId: randomUUID(),
    invocationId,
    sourceNodeId: serverId,
    targetNodeId: nodeId,
    providerId: 'infos.system.shell',
    envelope: {
      protocolVersion: 1,
      messageId: randomUUID(),
      correlationId: invocationId,
      principalId: 'pero',
      operation: `system.shell/${operation}`,
      sourceNodeId: serverId,
      targetNodeId: nodeId,
      route: { sourceNodeId: serverId, targetNodeId: nodeId, hopLimit: 8 },
      emittedAt: new Date().toISOString(),
      durability: 'ephemeral',
      carrier: 'memory',
      payload: { operation, input },
    },
  }
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true })
})

describe('Node Host 本地完整闭环', () => {
  it('生产WSS入口必须要求持久TrustStore', async () => {
    const host = new NodeHost({ identityPath: path.join(root(), 'node.json') })
    await expect(
      host.listenSecure({ key: 'invalid', cert: 'invalid', ca: 'invalid' }),
    ).rejects.toThrow('NODE_TRUST_STORE_REQUIRED')
    expect(host.diagnostics()).toMatchObject({ secureListening: false, trustedNodes: 0 })
  })

  it('身份应持久稳定，配对 Code 应一次性消费并签发可验证证书', () => {
    const issuerStore = new FileNodeIdentityStore(path.join(root(), 'issuer.json'))
    const nodeStore = new FileNodeIdentityStore(path.join(root(), 'node.json'))
    const descriptorBase = {
      displayName: '节点',
      facets: ['capability', 'compute'] as const,
      trust: 'local' as const,
      platform: { os: 'linux' as const, runtime: 'node' as const },
      protocolVersion: 1 as const,
      registeredAt: new Date().toISOString(),
    }
    const issuer = issuerStore.loadOrCreate(descriptorBase)
    const node = nodeStore.loadOrCreate({ ...descriptorBase, trust: 'untrusted' })
    expect(nodeStore.loadOrCreate(descriptorBase).descriptor.nodeId).toBe(node.descriptor.nodeId)
    const authority = new PairingAuthority(
      issuer.descriptor.nodeId,
      issuer.privateKeyPem,
      issuer.publicKeyPem,
    )
    const challenge = authority.createChallenge('pair-123456')
    const pairingRequest = {
      challengeId: challenge.challengeId,
      pairingCode: 'pair-123456',
      descriptor: node.descriptor,
      publicKeyPem: node.publicKeyPem,
      proof: authority.createProof({
        challengeId: challenge.challengeId,
        pairingCode: 'pair-123456',
        privateKeyPem: node.privateKeyPem,
      }),
    }
    const certificate = authority.pair(pairingRequest)
    expect(authority.verifyCertificate(certificate)).toBe(true)
    expect(() => authority.pair(pairingRequest)).toThrow('PAIRING_CHALLENGE_INVALID')
  })

  it('TrustStore应持久化证书、拒绝指纹冲突并执行撤销Epoch', () => {
    const base = root()
    const issuer = new FileNodeIdentityStore(path.join(base, 'issuer.json')).loadOrCreate({
      displayName: '签发节点',
      facets: ['server'],
      trust: 'local',
      platform: { os: 'linux', runtime: 'node' },
      protocolVersion: 1,
      registeredAt: new Date().toISOString(),
    })
    const node = new FileNodeIdentityStore(path.join(base, 'node.json')).loadOrCreate({
      displayName: '远程节点',
      facets: ['capability'],
      trust: 'untrusted',
      platform: { os: 'linux', runtime: 'node' },
      protocolVersion: 1,
      registeredAt: new Date().toISOString(),
    })
    const trustPath = path.join(base, 'trust.json')
    const trust = new PersistentNodeTrustStore(trustPath)
    const authority = new PairingAuthority(
      issuer.descriptor.nodeId,
      issuer.privateKeyPem,
      issuer.publicKeyPem,
      trust,
    )
    const challenge = authority.createChallenge('trust-123456')
    const certificate = authority.pair({
      challengeId: challenge.challengeId,
      pairingCode: 'trust-123456',
      descriptor: node.descriptor,
      publicKeyPem: node.publicKeyPem,
      proof: authority.createProof({
        challengeId: challenge.challengeId,
        pairingCode: 'trust-123456',
        privateKeyPem: node.privateKeyPem,
      }),
    })

    const restarted = new PersistentNodeTrustStore(trustPath)
    expect(
      restarted.assertTrusted({
        nodeId: node.descriptor.nodeId,
        publicKeyFingerprint: node.descriptor.publicKeyFingerprint,
        certificate,
      }).trust,
    ).toBe('paired')
    expect(() =>
      restarted.trust({
        nodeId: node.descriptor.nodeId,
        publicKeyPem: 'other',
        publicKeyFingerprint: 'other',
        trust: 'paired',
        trustEpoch: 2,
        certificate: { ...certificate, publicKeyFingerprint: 'other', trustEpoch: 2 },
      }),
    ).toThrow('NODE_TRUST_FINGERPRINT_CONFLICT')
    expect(restarted.revoke(node.descriptor.nodeId, '设备遗失')).toBe(true)
    expect(() =>
      restarted.assertTrusted({
        nodeId: node.descriptor.nodeId,
        publicKeyFingerprint: node.descriptor.publicKeyFingerprint,
        certificate,
      }),
    ).toThrow('NODE_NOT_TRUSTED')
  })

  it('Chunked Transfer应支持乱序、幂等和中断恢复，并拒绝冲突块', () => {
    const sender = new ChunkedNodeTransferRegistry()
    const receiver = new ChunkedNodeTransferRegistry()
    const bytes = Buffer.from('跨节点分块传输需要保留合法前缀并校验最终摘要'.repeat(20))
    const manifest = sender.createManifest(bytes, 64)
    const chunks = sender.chunks(manifest, bytes)
    receiver.begin(manifest)
    receiver.accept(chunks[1]!)
    receiver.accept(chunks[0]!)
    receiver.accept(chunks[0]!)
    expect(receiver.nextMissingIndex(manifest.transferId)).toBe(2)
    expect(() =>
      receiver.accept({ ...chunks[0]!, base64: Buffer.from('冲突').toString('base64') }),
    ).toThrow('TRANSFER_CHUNK_CHECKSUM_MISMATCH')
    for (const chunk of chunks.slice(2)) receiver.accept(chunk)
    expect(receiver.complete(manifest.transferId)).toEqual(bytes)
  })

  it('InMemory Transport 应完成 Echo、Asset、幂等、Deadline 与取消', async () => {
    const host = new NodeHost({ identityPath: path.join(root(), 'node.json') })
    host.registerProbeProviders()
    await host.start()
    const transport = host.inMemoryTransport(serverId)
    const nodeId = host.identity.descriptor.nodeId

    const echoed = await transport.request(request(nodeId, 'echo', { hello: 'world' }))
    expect(echoed).toMatchObject({ state: 'completed', output: { echo: { hello: 'world' } } })

    const asset = createNodeAssetPayload({
      assetId: 'asset-1',
      mimeType: 'text/plain',
      bytes: Buffer.from('hello'),
    })
    const transformed = await transport.request(
      request(nodeId, 'transformAsset', { asset }, { idempotencyKey: 'asset-transform' }),
    )
    const outputAsset = (transformed.output as { asset: typeof asset }).asset
    expect(verifyNodeAssetPayload(outputAsset).toString()).toBe('HELLO')
    const cached = await transport.request(
      request(nodeId, 'transformAsset', { asset }, { idempotencyKey: 'asset-transform' }),
    )
    expect(cached.completedAt).toBe(transformed.completedAt)

    const expired = await transport.request(
      request(nodeId, 'delay', { durationMs: 10 }, { deadline: new Date(0).toISOString() }),
    )
    expect(expired.state).toBe('timed_out')

    const controller = new AbortController()
    const invocationId = randomUUID()
    const delayed = transport.request(
      request(nodeId, 'delay', { durationMs: 10_000 }, { invocationId }),
      controller.signal,
    )
    setTimeout(() => controller.abort(), 10)
    expect((await delayed).state).toBe('cancelled')
    await host.stop()
  })

  it('system.shell 应创建长时会话并按游标读取节点输出', async () => {
    const host = new NodeHost({ identityPath: path.join(root(), 'node.json') })
    host.registerSystemShellProvider()
    await host.start()
    const transport = host.inMemoryTransport(serverId)
    const nodeId = host.identity.descriptor.nodeId
    const command = process.platform === 'win32' ? 'echo remote-shell' : "printf 'remote-shell\\n'"
    const created = await transport.request(shellRequest(nodeId, 'create', { command }))
    expect(created.state).toBe('completed')
    const terminalId = (created.output as { terminalId: string }).terminalId
    const waited = await transport.request(
      shellRequest(nodeId, 'wait', { terminalId, cursor: 0, timeoutMs: 5_000 }),
    )
    expect(waited).toMatchObject({ state: 'completed' })
    expect((waited.output as { output: string }).output).toContain('remote-shell')
    const listed = await transport.request(shellRequest(nodeId, 'list', {}))
    expect(listed.output).toEqual(expect.arrayContaining([expect.objectContaining({ terminalId })]))
    await transport.request(shellRequest(nodeId, 'close', { terminalId }))
    await host.stop()
  })

  it('篡改 Asset 摘要必须 fail-closed', async () => {
    const host = new NodeHost({ identityPath: path.join(root(), 'node.json') })
    host.registerProbeProviders()
    await host.start()
    const asset = createNodeAssetPayload({
      assetId: 'asset-bad',
      mimeType: 'text/plain',
      bytes: Buffer.from('hello'),
    })
    const receipt = await host.inMemoryTransport(serverId).request(
      request(host.identity.descriptor.nodeId, 'transformAsset', {
        asset: { ...asset, sha256: 'bad' },
      }),
    )
    expect(receipt).toMatchObject({ state: 'failed', error: { code: 'NODE_PROVIDER_FAILED' } })
    await host.stop()
  })

  it('连接拒绝时Hello等待应单次失败且不产生未处理拒绝', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试端口不可用')
    await new Promise<void>((resolve) => server.close(() => resolve()))

    const transport = new LoopbackWebSocketNodeTransport(serverId, `ws://127.0.0.1:${address.port}`)
    await expect(transport.waitForHello()).rejects.toBeInstanceOf(Error)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('Loopback WebSocket 应完成 Hello、跨进程协议 Invocation 与 Receipt', async () => {
    const host = new NodeHost({ identityPath: path.join(root(), 'node.json') })
    host.registerProbeProviders()
    await host.start()
    const port = await host.listenLoopback(0)
    const transport = new LoopbackWebSocketNodeTransport(serverId, `ws://127.0.0.1:${port}`)
    const receipt = await transport.request(
      request(host.identity.descriptor.nodeId, 'echo', { carrier: 'websocket' }),
    )
    expect(receipt).toMatchObject({
      state: 'completed',
      output: { echo: { carrier: 'websocket' } },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(transport.hello?.descriptor.nodeId).toBe(host.identity.descriptor.nodeId)
    expect(transport.hello?.offers[0]?.placement?.executionLocation).toBe('remote-capability-node')
    await transport.close()
    await host.stop()
  })

  it('Loopback WebSocket应拒绝外部网页Origin并允许localhost Surface', async () => {
    const host = new NodeHost({ identityPath: path.join(root(), 'node.json') })
    await host.start()
    const port = await host.listenLoopback(0)
    const denied = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://evil.example' })
    await expect(
      new Promise<void>((resolve, reject) => {
        denied.once('open', () => reject(new Error('外部Origin不应建立连接')))
        denied.once('error', () => resolve())
      }),
    ).resolves.toBeUndefined()
    const allowed = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://127.0.0.1:5178' })
    await expect(
      new Promise<void>((resolve, reject) => {
        allowed.once('open', () => resolve())
        allowed.once('error', reject)
      }),
    ).resolves.toBeUndefined()
    allowed.close()
    await host.stop()
  })
})

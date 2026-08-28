import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KernelExecutionId, KernelObjectId } from '@infos/shared'
import {
  AssetFileAuthority,
  LifecycleScope,
  RuntimeEventChannel,
  ScopedCredentialVault,
  TransferRegistry,
} from '@infos/backend/kernel'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Resource Foundation', () => {
  it('File Handle 应限制主体、操作、次数并检测文件篡改', () => {
    const root = path.join(tmpdir(), `infos-asset-${Date.now()}-${Math.random()}`)
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const filePath = path.join(root, 'demo.txt')
    writeFileSync(filePath, '原始内容')
    const authority = new AssetFileAuthority()
    const asset = authority.registerFile({
      ownerPrincipalId: 'pero',
      filePath,
      kind: 'document',
      mimeType: 'text/plain',
      source: 'user',
    })
    const handle = authority.issueHandle({
      subjectId: 'browser',
      assetRef: asset.ref,
      operations: ['upload'],
      maxUses: 1,
      mimeScope: ['text/plain'],
      sizeLimit: 1024,
    })

    expect(() => authority.consume(handle.handleId, 'other', 'upload')).toThrow(
      'FILE_HANDLE_SUBJECT_DENIED',
    )
    expect(authority.consume(handle.handleId, 'browser', 'upload').asset.sha256).toBe(asset.sha256)
    expect(() => authority.consume(handle.handleId, 'browser', 'upload')).toThrow(
      'FILE_HANDLE_EXHAUSTED',
    )

    const second = authority.issueHandle({
      subjectId: 'browser',
      assetRef: asset.ref,
      operations: ['read'],
    })
    writeFileSync(filePath, '篡改内容')
    expect(() => authority.consume(second.handleId, 'browser', 'read')).toThrow('ASSET_CHANGED')
  })

  it('File Handle 应随 LifecycleScope 自动撤销', async () => {
    const root = path.join(tmpdir(), `infos-scope-${Date.now()}-${Math.random()}`)
    roots.push(root)
    mkdirSync(root, { recursive: true })
    const filePath = path.join(root, 'demo.txt')
    writeFileSync(filePath, '内容')
    const authority = new AssetFileAuthority()
    const asset = authority.registerFile({
      ownerPrincipalId: 'pero',
      filePath,
      kind: 'document',
      mimeType: 'text/plain',
      source: 'user',
    })
    const scope = new LifecycleScope('文件授权')
    const handle = authority.issueHandle(
      { subjectId: 'tool', assetRef: asset.ref, operations: ['read'] },
      scope,
    )
    await scope.dispose()
    expect(() => authority.consume(handle.handleId, 'tool', 'read')).toThrow('FILE_HANDLE_REVOKED')
  })

  it('Transfer 应拒绝非法迁移、进度倒退和无结果完成', () => {
    const registry = new TransferRegistry()
    const transfer = registry.create({
      direction: 'download',
      principalId: 'pero',
      correlationId: 'download-1',
      bytesTotal: 100,
    })
    expect(() => registry.progress(transfer.transferId, 1)).toThrow('TRANSFER_NOT_RUNNING')
    registry.transition(transfer.transferId, 'running')
    registry.progress(transfer.transferId, 50)
    expect(() => registry.progress(transfer.transferId, 40)).toThrow('TRANSFER_PROGRESS_REGRESSION')
    expect(() => registry.transition(transfer.transferId, 'completed')).toThrow(
      'TRANSFER_RESULT_REQUIRED',
    )
    const resultRef = {
      objectType: 'asset',
      objectId: 'result' as KernelObjectId,
      generation: 1,
      ownerPrincipalId: 'pero',
    }
    const completed = registry.transition(transfer.transferId, 'completed', {
      resultAssetRef: resultRef,
    })
    expect(completed.state).toBe('completed')
    expect(() => registry.transition(transfer.transferId, 'running')).toThrow(
      'TRANSFER_INVALID_TRANSITION',
    )
  })

  it('Runtime Event 应单调递增并在 generation 变化时重置', async () => {
    const channel = new RuntimeEventChannel()
    const handler = vi.fn()
    const scope = new LifecycleScope('Runtime 订阅')
    channel.subscribe(handler, scope)
    const runtimeRef = {
      objectType: 'web-runtime',
      objectId: 'runtime' as KernelObjectId,
      generation: 1,
      ownerPrincipalId: 'system',
    }
    const first = await channel.publish({
      runtimeRef,
      eventType: 'page.changed',
      payload: { a: 1 },
    })
    const second = await channel.publish({
      runtimeRef,
      eventType: 'page.changed',
      payload: { a: 2 },
    })
    const next = await channel.publish({
      runtimeRef: { ...runtimeRef, generation: 2 },
      eventType: 'page.changed',
      payload: { a: 3 },
    })
    expect([first.sequence, second.sequence, next.sequence]).toEqual([1, 2, 1])
    await scope.dispose()
    expect(channel.subscriberCount).toBe(0)
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('Credential Handle 应收窄 Scope、绑定 Execution 并限次消费秘密', () => {
    const vault = new ScopedCredentialVault()
    const credential = vault.register({
      ownerPrincipalId: 'pero',
      kind: 'http-bearer',
      secret: 'top-secret',
      operations: ['authorize'],
      originScope: ['https://example.com'],
      audience: ['api'],
    })
    expect(() =>
      vault.issueHandle({
        credentialRef: credential.ref,
        subjectId: 'browser',
        operations: ['authorize'],
        originScope: ['https://evil.example'],
      }),
    ).toThrow('CREDENTIAL_HANDLE_EXPANDS_SCOPE')

    const executionId = 'execution-1' as KernelExecutionId
    const handle = vault.issueHandle({
      credentialRef: credential.ref,
      subjectId: 'browser',
      operations: ['authorize'],
      originScope: ['https://example.com'],
      audience: ['api'],
      executionId,
      maxUses: 1,
    })
    expect(() =>
      vault.consume({
        handleId: handle.handleId,
        subjectId: 'browser',
        operation: 'authorize',
        origin: 'https://example.com',
        audience: 'api',
        executionId: 'other' as KernelExecutionId,
      }),
    ).toThrow('CREDENTIAL_HANDLE_EXECUTION_DENIED')
    expect(
      vault.consume({
        handleId: handle.handleId,
        subjectId: 'browser',
        operation: 'authorize',
        origin: 'https://example.com',
        audience: 'api',
        executionId,
      }),
    ).toBe('top-secret')
    expect(() =>
      vault.consume({
        handleId: handle.handleId,
        subjectId: 'browser',
        operation: 'authorize',
        origin: 'https://example.com',
        audience: 'api',
        executionId,
      }),
    ).toThrow('CREDENTIAL_HANDLE_EXHAUSTED')
  })
})

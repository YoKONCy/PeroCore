import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import type { KernelEnvelope, KernelNodeId } from '@infos/shared'
import type { NodeInvokeRequest } from '@infos/node-sdk'
import { LoopbackWebSocketNodeTransport } from '../src/index'

const children: ChildProcessWithoutNullStreams[] = []
const roots: string[] = []
const serverId = 'server-process' as KernelNodeId

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (!child.killed) child.kill('SIGTERM')
    await new Promise((resolve) => child.once('exit', resolve))
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Node Host Loopback 跨进程探针', () => {
  it('独立 Node Host 进程应发布 Hello 并完成 Invocation Receipt', async () => {
    const root = path.join(tmpdir(), `infos-node-process-${randomUUID()}`)
    roots.push(root)
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.resolve('packages/node-host/src/main.ts'), '--loopback-port=0'],
      {
        cwd: path.resolve('.'),
        env: { ...process.env, INFOS_NODE_IDENTITY_PATH: path.join(root, 'identity.json') },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    children.push(child)
    const port = await new Promise<number>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error(`Node Host 启动超时: ${output}`)), 10_000)
      child.stdout.on('data', (chunk) => {
        output += String(chunk)
        const match = output.match(/ws:\/\/127\.0\.0\.1:(\d+)/)
        if (match?.[1]) {
          clearTimeout(timer)
          resolve(Number(match[1]))
        }
      })
      child.stderr.on('data', (chunk) => {
        output += String(chunk)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Node Host 提前退出 ${code}: ${output}`))
      })
    })
    const transport = new LoopbackWebSocketNodeTransport(serverId, `ws://127.0.0.1:${port}`)
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5_000
      const poll = () => {
        if (transport.hello) resolve()
        else if (Date.now() >= deadline) reject(new Error('未收到 Node Hello'))
        else setTimeout(poll, 10)
      }
      poll()
    })
    const nodeId = transport.hello!.descriptor.nodeId
    const invocationId = randomUUID()
    const envelope: KernelEnvelope<{ operation: string; input: unknown }> = {
      protocolVersion: 1,
      messageId: randomUUID(),
      correlationId: invocationId,
      principalId: 'pero',
      operation: 'probe.echo-asset/echo',
      sourceNodeId: serverId,
      targetNodeId: nodeId,
      route: { sourceNodeId: serverId, targetNodeId: nodeId, hopLimit: 8 },
      emittedAt: new Date().toISOString(),
      durability: 'ephemeral',
      carrier: 'websocket',
      payload: { operation: 'echo', input: { process: true } },
    }
    const request: NodeInvokeRequest = {
      protocolVersion: 1,
      type: 'invoke',
      messageId: randomUUID(),
      invocationId,
      sourceNodeId: serverId,
      targetNodeId: nodeId,
      providerId: 'infos.probe.echo-asset',
      envelope,
    }
    const receipt = await transport.request(request)
    expect(receipt).toMatchObject({ state: 'completed', output: { echo: { process: true } } })
    await transport.close()
  })
})

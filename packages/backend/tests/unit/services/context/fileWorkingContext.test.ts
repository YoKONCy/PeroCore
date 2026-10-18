import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatMessage } from '../../../../src/services/llm/types'
import {
  projectFileWorkingContext,
  retainedFileState,
  type FileObservation,
} from '../../../../src/services/context/fileWorkingContext'
import { OpenAiProvider } from '../../../../src/services/llm/providers/openaiProvider'

let directory: string | undefined
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('文件事实跨轮保存与模型投影', () => {
  it('普通续轮追加变化状态，不重写已发送快照或提前移除过期读取', async () => {
    directory = await mkdtemp(path.join(process.env.INFOS_TEST_TEMP_ROOT!, 'file-prefix-'))
    const file = path.join(directory, 'a.txt')
    await writeFile(file, '初始正文')
    const fact: FileObservation = {
      path: file,
      version: createHash('sha256').update('初始正文').digest('hex'),
      kind: 'read',
      callId: 'read',
    }
    const input: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          { id: 'read', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      },
      { role: 'tool', toolCallId: 'read', content: '初始正文', fileObservations: [fact] },
    ]
    const first = await projectFileWorkingContext(input)
    const firstCopy = structuredClone(first)
    expect(await projectFileWorkingContext(first)).toEqual(first)
    await writeFile(file, '变化后的正文')
    const next = await projectFileWorkingContext([
      ...first,
      { role: 'assistant', content: '继续核对文件' },
    ])
    expect(next.slice(0, first.length)).toEqual(firstCopy)
    expect(first).toEqual(firstCopy)
    expect(next.at(-1)?.content).toContain('当前内容已变化')
    expect(next.find((message) => message.toolCallId === 'read')?.content).toBe('初始正文')
    const compacted = await projectFileWorkingContext(next, { compact: true })
    expect(compacted.some((message) => message.toolCallId === 'read')).toBe(false)
  })

  it('单个 NIT 批次包含多次写入时，不能把最新写入所在整组提前淘汰', async () => {
    const observations: FileObservation[] = ['一', '二', '三'].map((callId) => ({
      path: path.resolve('nit-batch.txt'),
      version: '0'.repeat(64),
      kind: 'write',
      callId,
    }))
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id: 'script',
            type: 'function',
            function: { name: 'run_script', arguments: '{"code":"最新批量写入"}' },
          },
        ],
      },
      { role: 'tool', toolCallId: 'script', content: '已写入', fileObservations: observations },
    ]
    const projected = await projectFileWorkingContext(messages, { compact: true })
    expect(
      projected.some((message) => message.toolCalls?.some((call) => call.id === 'script')),
    ).toBe(true)
  })

  it('淘汰被替代的大参数和过期读取，保留最近执行及原始审计', async () => {
    const temporary = fileURLToPath(new URL('../../../../../../TEMP/', import.meta.url))
    await mkdir(temporary, { recursive: true })
    directory = await mkdtemp(path.join(temporary, 'file-state-'))
    const file = path.join(directory, 'a.txt')
    await writeFile(file, '当前正文')
    const version = createHash('sha256').update('当前正文').digest('hex')
    const messages: ChatMessage[] = [{ role: 'user', content: '完成修改并核对' }]
    for (let index = 0; index < 12; index++) {
      const id = `call-${index}`
      messages.push({
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id,
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                file_path: file,
                content: `旧正文-${index}`.repeat(1000),
              }),
            },
          },
        ],
      })
      messages.push({
        role: 'tool',
        toolCallId: id,
        content: '{"success":true}',
        fileObservations: [
          {
            path: file,
            version: index === 11 ? version : String(index).padStart(64, '0'),
            kind: 'write',
            callId: id,
          },
        ],
      })
    }
    const original = JSON.stringify(messages)
    const projected = await projectFileWorkingContext(messages, { compact: true })
    expect(JSON.stringify(messages)).toBe(original)
    expect(projected.flatMap((message) => message.toolCalls ?? [])).toHaveLength(2)
    expect(JSON.stringify(projected)).not.toContain('旧正文-0旧正文-0')
    const ids = new Set(
      projected.flatMap((message) => message.toolCalls?.map((call) => call.id) ?? []),
    )
    for (const message of projected)
      if (message.role === 'tool') expect(ids.has(message.toolCallId!)).toBe(true)
    const state = projected.find((message) =>
      String(message.content).startsWith('【文件执行状态：数据】'),
    )
    expect(state?.content).toContain('内容指纹一致')
    expect(state?.content).toContain('不能据此判定任务完成')
    expect(state?.content).toContain('可按任务继续编辑，成功写入后会更新记录')
    expect(state?.content).toContain('是否交付应依据用户要求与实际验证结果')
    const provider = new OpenAiProvider({
      apiKey: '',
      apiBase: 'https://example.invalid',
      modelId: 'test',
    })
    expect(JSON.stringify(provider.getInputTokenPayload(projected, {}))).not.toContain(
      'fileObservations',
    )
    const restored = retainedFileState(projected, [])
    expect(restored.find((fact) => fact.path === file)?.version).toBe(version)
  })

  it('DeepSeek文本思考的完整工具轮不能被过期文件投影移除', async () => {
    const file = path.resolve('expired-reasoning.txt')
    const messages: ChatMessage[] = [
      { role: 'user', content: '处理文件' },
      {
        role: 'assistant',
        content: '先读取旧版本',
        reasoningContent: '第一段\n第二段',
        toolCalls: [
          {
            id: 'reasoned-read',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'reasoned-read',
        content: '过期读取正文',
        fileObservations: [
          { path: file, version: '0'.repeat(64), kind: 'read', callId: 'reasoned-read' },
        ],
      },
    ]
    const original = structuredClone(messages)
    const projected = await projectFileWorkingContext(messages, { compact: true })
    expect(projected.find((message) => message.role === 'assistant')).toEqual(messages[1])
    expect(projected.find((message) => message.toolCallId === 'reasoned-read')?.content).toBe(
      '过期读取正文',
    )
    expect(messages).toEqual(original)
  })

  it('签名续接、未完成调用和显式比较材料不被淘汰', async () => {
    const fact: FileObservation = {
      path: path.resolve('a.txt'),
      version: '0'.repeat(64),
      kind: 'read',
      callId: 'pinned',
      pinned: true,
    }
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          { id: 'pinned', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      },
      { role: 'tool', toolCallId: 'pinned', content: '需要比较的旧正文', fileObservations: [fact] },
      {
        role: 'assistant',
        content: null,
        nativeReasoning: [{ format: 'reasoning_details', opaque: { signature: '签名' } }],
        toolCalls: [
          { id: 'signed', type: 'function', function: { name: 'read_file', arguments: '{}' } },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'signed',
        content: '受保护结果',
        fileObservations: [{ ...fact, pinned: false, callId: 'signed' }],
      },
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          { id: 'pending', type: 'function', function: { name: 'edit_file', arguments: '{}' } },
        ],
      },
    ]
    const projected = await projectFileWorkingContext(messages, { compact: true })
    expect(projected.some((message) => message.content === '需要比较的旧正文')).toBe(true)
    expect(projected.some((message) => message.nativeReasoning?.length)).toBe(true)
    expect(
      projected.some((message) => message.toolCalls?.some((call) => call.id === 'pending')),
    ).toBe(true)
  })
})

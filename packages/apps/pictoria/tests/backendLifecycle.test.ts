import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PictoriaApplication } from '../src/application'
import { Store } from '../src/store'
import { expandWorkflow } from '../src/workflows'
import { validate } from '../src/schema'
import type { Step, Workflow } from '../src/domain'

const migrations = fileURLToPath(new URL('../src/database/migrations', import.meta.url))
const owner = 'test-owner'
const scope = { owner, callId: 'trusted-call' }
const textSchema = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
}
const inputSchema = {
  type: 'object',
  properties: { prompt: { type: 'string' } },
  required: ['prompt'],
  additionalProperties: false,
}
const fixtures: Array<{ root: string; store: Store; app: PictoriaApplication }> = []

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pictoria-backend-'))
  const store = new Store(root, migrations)
  const value = { root, store, app: new PictoriaApplication(store) }
  fixtures.push(value)
  return value
}
async function configure(
  value: ReturnType<typeof fixture>,
  outputs: Record<string, { path: string; kind: string }> = {
    text: { path: 'text', kind: 'text' },
  },
  outputSchema: Record<string, unknown> = textSchema,
) {
  await value.app.invoke(
    'service.save',
    {
      definition: {
        id: 'service',
        name: '测试服务',
        baseUrl: 'https://service.invalid',
        submit: { path: '/generate', fields: { prompt: { from: 'prompt' } }, outputs },
      },
    },
    scope,
  )
  return (await value.app.invoke(
    'step.save',
    {
      definition: {
        id: 'edit',
        name: '测试步骤',
        inputSchema,
        outputSchema,
        implementation: { kind: 'service', serviceId: 'service' },
      },
    },
    scope,
  )) as Step
}
async function submit(
  value: ReturnType<typeof fixture>,
  step: Step,
  prompt: unknown,
  key = 'request',
) {
  return (await value.app.invoke(
    'task.submit',
    { stepId: step.id, stepRevision: step.revision, inputs: { prompt } },
    { ...scope, key },
  )) as { taskId: string }
}
afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    await value.app.execution.stop()
    value.store.close()
    if (path.dirname(path.resolve(value.root)) !== path.resolve(tmpdir()))
      throw new Error('临时目录越界')
    rmSync(value.root, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
})

describe('Pictoria 后端业务边界', () => {
  it('字段不符合步骤 schema 时不接受任务，也不发起服务请求', async () => {
    const value = fixture()
    const step = await configure(value)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(submit(value, step, 42)).rejects.toThrow()
    expect(value.store.runs(owner)).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('服务字段映射错误在付费提交前失败，不标记为提交结果不确定', async () => {
    const value = fixture()
    const step = await configure(value)
    const service = value.store.get<{ id: string; revision: number }>(owner, 'service', 'service')!
    await value.app.invoke(
      'service.save',
      {
        expectedRevision: service.revision,
        definition: {
          id: 'service',
          name: '测试服务',
          baseUrl: 'https://service.invalid',
          submit: {
            path: '/generate',
            fields: { prompt: { from: 'missing' } },
            outputs: { text: { path: 'text', kind: 'text' } },
          },
        },
      },
      scope,
    )
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const run = await submit(value, step, '编辑要求')
    await vi.waitFor(() => expect(value.store.run(run.taskId)?.state).toBe('failed'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('提示词按作者声明的字段原样发送，不自行改写为标签', async () => {
    const value = fixture()
    const step = await configure(value)
    const instruction = '保留人物和构图，把外套换成白色。'
    const requests: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        requests.push(JSON.parse(init.body))
        return new Response(JSON.stringify({ text: '完成' }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const run = await submit(value, step, instruction)
    await vi.waitFor(() => expect(value.store.run(run.taskId)?.state).toBe('completed'))
    expect(requests).toEqual([{ prompt: instruction }])
  })

  it('重启和步骤停用后，相同幂等请求仍返回已经接收的任务', async () => {
    const value = fixture()
    const step = await configure(value)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ text: '完成' }), {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const first = await submit(value, step, '编辑要求')
    await vi.waitFor(() => expect(value.store.run(first.taskId)?.state).toBe('completed'))
    const { revision: _revision, ...definition } = step
    await value.app.invoke(
      'step.save',
      { definition: { ...definition, enabled: false }, expectedRevision: step.revision },
      scope,
    )
    await value.app.execution.stop()
    value.store.close()
    value.store = new Store(value.root, migrations)
    value.app = new PictoriaApplication(value.store)
    const repeated = await submit(value, step, '编辑要求')
    expect(repeated.taskId).toBe(first.taskId)
    expect(value.store.runs(owner)).toHaveLength(1)
    await expect(submit(value, step, '不同要求')).rejects.toThrow()
  })

  it('发布版本继续引用旧步骤契约，修改当前步骤不改变历史工作流', async () => {
    const value = fixture()
    const step = await configure(value)
    const workflow = (await value.app.invoke(
      'workflow.save',
      {
        definition: {
          id: 'flow',
          name: '工作流',
          inputSchema,
          outputSchema: textSchema,
          nodes: [
            {
              id: 'edit',
              stepId: step.id,
              stepRevision: step.revision,
              inputs: { prompt: { input: 'prompt' } },
            },
          ],
          outputs: { text: { node: 'edit', output: 'text' } },
        },
      },
      scope,
    )) as Workflow
    await value.app.invoke(
      'workflow.publish',
      { id: workflow.id, expectedRevision: workflow.revision },
      scope,
    )
    const { revision: _revision, ...definition } = step
    await value.app.invoke(
      'step.save',
      {
        definition: {
          ...definition,
          inputSchema: {
            type: 'object',
            properties: { tags: { type: 'array', items: { type: 'string' } } },
            required: ['tags'],
            additionalProperties: false,
          },
        },
        expectedRevision: step.revision,
      },
      scope,
    )
    const historical = value.store.get<{ snapshot: Workflow }>(
      owner,
      'published',
      `${workflow.id}:${workflow.revision}`,
    )!.snapshot
    const compiled = expandWorkflow(historical, value.store, owner)
    expect(() =>
      validate(compiled.nodes[0]!.step.inputSchema, { prompt: '自然语言要求' }),
    ).not.toThrow()
    expect(() =>
      validate(value.store.get<Step>(owner, 'step', step.id)!.inputSchema, {
        prompt: '自然语言要求',
      }),
    ).toThrow()
  })

  it('提交结果不确定时，重启不会再次调用生成服务', async () => {
    const value = fixture()
    const step = await configure(value)
    const fetch = vi.fn(async () => {
      throw new TypeError('连接中断')
    })
    vi.stubGlobal('fetch', fetch)
    const run = await submit(value, step, '编辑要求')
    await vi.waitFor(() => expect(value.store.run(run.taskId)?.state).toBe('waiting'))
    await value.app.execution.stop()
    value.store.close()
    value.store = new Store(value.root, migrations)
    value.app = new PictoriaApplication(value.store)
    value.app.execution.start()
    await expect(value.app.invoke('task.resume', { id: run.taskId }, scope)).rejects.toThrow()
    expect(value.store.run(run.taskId)?.state).toBe('waiting')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('独立分支失败时保留成功分支的输出', async () => {
    const value = fixture()
    const step = await configure(value)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const { prompt } = JSON.parse(init.body)
        return prompt === '失败分支'
          ? new Response('{}', { status: 400 })
          : new Response(JSON.stringify({ text: '可用结果' }), {
              headers: { 'content-type': 'application/json' },
            })
      }),
    )
    const run = (await value.app.invoke(
      'task.submit',
      {
        definition: {
          id: 'branches',
          name: '并行创作',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          outputSchema: {
            type: 'object',
            properties: { first: { type: 'string' }, second: { type: 'string' } },
            required: ['first', 'second'],
          },
          nodes: ['成功分支', '失败分支'].map((prompt, index) => ({
            id: `branch-${index}`,
            stepId: step.id,
            stepRevision: step.revision,
            inputs: { prompt: { literal: prompt } },
          })),
          outputs: {
            first: { node: 'branch-0', output: 'text' },
            second: { node: 'branch-1', output: 'text' },
          },
        },
        inputs: {},
      },
      { ...scope, key: 'branches' },
    )) as { taskId: string }
    await vi.waitFor(() => expect(value.store.run(run.taskId)?.state).toBe('partial'))
    expect(value.store.run(run.taskId)?.result).toEqual({ first: '可用结果' })
  })

  it('异步提交缺少任务 ID 时等待核验，绑定已有任务后只查询、不重新生成', async () => {
    const value = fixture()
    const step = await configure(value)
    const service = value.store.get<{ revision: number }>(owner, 'service', 'service')!
    await value.app.invoke(
      'service.save',
      {
        expectedRevision: service.revision,
        definition: {
          id: 'service',
          name: '异步服务',
          baseUrl: 'https://service.invalid',
          submit: {
            path: '/generate',
            taskIdField: 'id',
            fields: { prompt: { from: 'prompt' } },
            outputs: { text: { path: 'text', kind: 'text' } },
          },
          poll: { path: '/tasks/{id}', stateField: 'state', success: ['done'], failed: ['failed'] },
        },
      },
      scope,
    )
    let submissions = 0
    const queries: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (source) => {
        const pathname = new URL(String(source)).pathname
        if (pathname === '/generate') {
          submissions++
          return new Response('{}', { headers: { 'content-type': 'application/json' } })
        }
        queries.push(pathname)
        return new Response(JSON.stringify({ state: 'done', text: '已有作品' }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const run = await submit(value, step, '生成要求')
    await vi.waitFor(() => expect(value.store.run(run.taskId)?.state).toBe('waiting'))
    const node = value.store.run(run.taskId)!.nodes[0]!
    await expect(value.app.invoke('task.resume', { id: run.taskId }, scope)).rejects.toThrow()
    await value.app.invoke(
      'task.resume',
      { id: run.taskId, nodeId: node.id, remoteId: 'existing-task' },
      scope,
    )
    await vi.waitFor(() => expect(value.store.run(run.taskId)?.state).toBe('completed'))
    expect(submissions).toBe(1)
    expect(queries).toEqual(['/tasks/existing-task'])
    expect(value.store.run(run.taskId)?.result).toEqual({ text: '已有作品' })
  })

  it('多个不确定分支可以逐个核验，不丢失已经绑定的远程 ID', async () => {
    const value = fixture()
    const step = await configure(value)
    const service = value.store.get<{ revision: number }>(owner, 'service', 'service')!
    await value.app.invoke(
      'service.save',
      {
        expectedRevision: service.revision,
        definition: {
          id: 'service',
          name: '异步服务',
          baseUrl: 'https://service.invalid',
          submit: {
            path: '/generate',
            taskIdField: 'id',
            fields: { prompt: { from: 'prompt' } },
            outputs: { text: { path: 'text', kind: 'text' } },
          },
          poll: { path: '/tasks/{id}', stateField: 'state', success: ['done'], failed: ['failed'] },
        },
      },
      scope,
    )
    let submissions = 0
    const queries: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (source) => {
        const pathname = new URL(String(source)).pathname
        if (pathname === '/generate') {
          submissions++
          throw new TypeError('响应中断')
        }
        queries.push(pathname)
        return new Response(JSON.stringify({ state: 'done', text: '已完成' }), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const accepted = (await value.app.invoke(
      'task.submit',
      {
        definition: {
          id: 'parallel',
          name: '并行任务',
          inputSchema,
          outputSchema: {
            type: 'object',
            properties: { first: { type: 'string' }, second: { type: 'string' } },
            required: ['first', 'second'],
          },
          nodes: ['first', 'second'].map((id) => ({
            id,
            stepId: step.id,
            stepRevision: step.revision,
            inputs: { prompt: { input: 'prompt' } },
          })),
          outputs: {
            first: { node: 'first', output: 'text' },
            second: { node: 'second', output: 'text' },
          },
        },
        inputs: { prompt: '生成要求' },
      },
      { ...scope, key: 'parallel' },
    )) as { taskId: string }
    await vi.waitFor(() => expect(value.store.run(accepted.taskId)?.state).toBe('waiting'))
    await value.app.invoke(
      'task.resume',
      { id: accepted.taskId, nodeId: 'first', remoteId: 'remote-first' },
      scope,
    )
    expect(value.store.run(accepted.taskId)?.state).toBe('waiting')
    expect(
      value.store.run(accepted.taskId)?.nodes.find((node) => node.id === 'first')?.remoteId,
    ).toBe('remote-first')
    expect(queries).toHaveLength(0)
    await value.app.invoke(
      'task.resume',
      { id: accepted.taskId, nodeId: 'second', remoteId: 'remote-second' },
      scope,
    )
    await vi.waitFor(() => expect(value.store.run(accepted.taskId)?.state).toBe('completed'))
    expect(submissions).toBe(2)
    expect(queries.sort()).toEqual(['/tasks/remote-first', '/tasks/remote-second'])
  })

  it('缺少必填输出连接的工作流不能提交付费执行', async () => {
    const value = fixture()
    const step = await configure(value)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      value.app.invoke(
        'task.submit',
        {
          definition: {
            id: 'missing-output',
            name: '未完成配置',
            inputSchema,
            outputSchema: textSchema,
            nodes: [
              {
                id: 'edit',
                stepId: step.id,
                stepRevision: step.revision,
                inputs: { prompt: { input: 'prompt' } },
              },
            ],
            outputs: {},
          },
          inputs: { prompt: '生成要求' },
        },
        { ...scope, key: 'missing-output' },
      ),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(value.store.runs(owner)).toHaveLength(0)
  })

  it('任务查询不回传提供商原始响应或私有服务配置', async () => {
    const value = fixture()
    const step = await configure(
      value,
      { image: { path: 'url', kind: 'image' } },
      { type: 'object', properties: { image: { type: 'object' } }, required: ['image'] },
    )
    const rawReceipt = 'private-receipt-fixture'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (source) =>
        new URL(String(source)).pathname === '/generate'
          ? new Response(
              JSON.stringify({ url: 'https://service.invalid/image', receipt: rawReceipt }),
              { headers: { 'content-type': 'application/json' } },
            )
          : new Response(null, { status: 503 }),
      ),
    )
    const run = await submit(value, step, '生成要求')
    await vi.waitFor(() => expect(value.store.run(run.taskId)?.nodes[0]?.state).toBe('saving'))
    const snapshot = (await value.app.invoke('task.get', { id: run.taskId }, scope)) as {
      nodes: Record<string, unknown>[]
    }
    expect(JSON.stringify(snapshot)).not.toContain(rawReceipt)
    expect(snapshot.nodes[0]).not.toHaveProperty('service')
    expect(snapshot.nodes[0]).not.toHaveProperty('response')
  })

  it('凭据不出现在服务查询里，其他使用者也不能读取素材', async () => {
    const value = fixture()
    const key = 'private-key-fixture'
    await value.app.invoke(
      'service.save',
      {
        definition: {
          id: 'private',
          name: '私有服务',
          baseUrl: 'https://service.invalid',
          credential: key,
          submit: { path: '/generate' },
        },
      },
      scope,
    )
    expect(JSON.stringify(await value.app.invoke('service.list', {}, scope))).not.toContain(key)
    expect(value.store.secret(owner, 'private')).toBe(key)
    const asset = await value.app.assets.save(owner, '文本', 'text/plain', Buffer.from('私人素材'))
    expect(() => value.store.asset(asset.id, 'another-owner')).toThrow()
  })

  it('循环依赖不能发布为可执行步骤', async () => {
    const value = fixture()
    const step = await configure(value)
    const workflow = (await value.app.invoke(
      'workflow.save',
      {
        definition: {
          id: 'cyclic',
          name: '循环草稿',
          inputSchema: { type: 'object', properties: {} },
          outputSchema: textSchema,
          nodes: [
            {
              id: 'first',
              stepId: step.id,
              stepRevision: step.revision,
              inputs: { prompt: { node: 'second', output: 'text' } },
            },
            {
              id: 'second',
              stepId: step.id,
              stepRevision: step.revision,
              inputs: { prompt: { node: 'first', output: 'text' } },
            },
          ],
          outputs: { text: { node: 'first', output: 'text' } },
        },
      },
      scope,
    )) as Workflow
    await expect(
      value.app.invoke(
        'workflow.publish',
        { id: workflow.id, expectedRevision: workflow.revision },
        scope,
      ),
    ).rejects.toThrow()
    expect(value.store.get(owner, 'step', workflow.id)).toBeUndefined()
    expect(value.store.runs(owner)).toHaveLength(0)
  })

  it('作品下载暂时失败后自动恢复下载，不重复请求生成', async () => {
    const value = fixture()
    const step = await configure(
      value,
      { image: { path: 'url', kind: 'image' } },
      {
        type: 'object',
        properties: {
          image: {
            type: 'object',
            properties: { assetId: { type: 'string' } },
            required: ['assetId'],
          },
        },
        required: ['image'],
      },
    )
    let downloads = 0
    let submissions = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (source) => {
        if (new URL(String(source)).pathname === '/generate') {
          submissions++
          return new Response(JSON.stringify({ url: 'https://service.invalid/result.gif' }), {
            headers: { 'content-type': 'application/json' },
          })
        }
        downloads++
        if (downloads === 1) return new Response(null, { status: 503 })
        const pixel = Buffer.from(
          'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          'base64',
        )
        return new Response(new Uint8Array(pixel), { headers: { 'content-type': 'image/gif' } })
      }),
    )
    const run = await submit(value, step, '生成要求')
    await vi.waitFor(() => expect(downloads).toBe(1))
    await vi.waitFor(() => expect(value.store.run(run.taskId)?.state).toBe('completed'), {
      timeout: 5000,
    })
    expect(submissions).toBe(1)
    expect(downloads).toBe(2)
    const result = value.store.run(run.taskId)!.result!.image as { assetId: string }
    expect(value.store.asset(result.assetId, owner).mimeType).toBe('image/gif')
  })
})

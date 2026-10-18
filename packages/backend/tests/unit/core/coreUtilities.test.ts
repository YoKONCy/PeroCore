import { mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PackageHookBus } from '@infos/backend/packages'
import { PromptTemplateLoader } from '@infos/backend/core/promptTemplateLoader'
import { LogFileTransport, formatLogLine } from '@infos/backend/lib/logFileTransport'
import { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'
import type { PathResolver } from '@infos/backend/core/pathResolver'

function createResolver(root: string, workshop = true): PathResolver {
  return {
    resolve: vi.fn((alias: string) =>
      alias === '@data'
        ? join(root, 'data')
        : join(
            root,
            alias
              .replace('@data/', 'data/')
              .replace('@workshop/', 'workshop/')
              .replace('@workshop', 'workshop')
              .replace('@app/', 'app/'),
          ),
    ),
    isAvailable: vi.fn((alias: string) => alias === '@workshop' && workshop),
    // Workshop 多根支持（PromptTemplateLoader 依赖）
    getRoots: vi.fn((prefix: string) =>
      prefix === '@workshop' && workshop ? [join(root, 'workshop')] : [],
    ),
  } as unknown as PathResolver
}

describe('PackageHookBus', () => {
  it('应当按注册顺序串行执行 Interceptor 并传递修改后的数据', async () => {
    const bus = new PackageHookBus()
    const first = vi.fn(async (data: unknown) => ({ value: (data as { value: number }).value + 1 }))
    const second = vi.fn(async (data: unknown) => ({
      value: (data as { value: number }).value * 2,
    }))

    const removeFirst = bus.register('package-a', 'chat:beforeSend', first)
    bus.register('package-b', 'chat:beforeSend', second)
    await expect(bus.emitHook('chat:beforeSend', { value: 2 })).resolves.toEqual({ value: 6 })

    removeFirst()
    await expect(bus.emitHook('chat:beforeSend', { value: 2 })).resolves.toEqual({ value: 4 })
  })

  it('应当支持 abort 中断后续 Interceptor', async () => {
    const bus = new PackageHookBus()
    const skipped = vi.fn()
    bus.register('package-a', 'chat:beforeSend', async (_data, context) => {
      context.abort('停止')
      return { value: 9 }
    })
    bus.register('package-b', 'chat:beforeSend', skipped)

    await expect(bus.emitHook('chat:beforeSend', { value: 1 })).resolves.toEqual({ value: 9 })
    expect(skipped).not.toHaveBeenCalled()
  })
})

describe('PromptTemplateLoader', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `infos-template-${Date.now()}-${Math.random()}`)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('应当按 custom、workshop、official 优先级加载模板并判断来源', async () => {
    const resolver = createResolver(root)
    const loader = new PromptTemplateLoader(resolver)
    // 官方路径与 promptTemplateLoader 当前实现对齐
    const officialDir = join(root, 'app', 'backend', 'src', 'services', 'mdp', 'prompts', 'tasks')
    mkdirSync(officialDir, { recursive: true })
    mkdirSync(join(root, 'workshop', 'prompts', 'tasks'), { recursive: true })
    mkdirSync(join(root, 'data', 'custom', 'prompts', 'tasks'), { recursive: true })
    writeFileSync(join(officialDir, 'demo.md'), 'official')
    writeFileSync(join(root, 'workshop', 'prompts', 'tasks', 'demo.md'), 'workshop')
    writeFileSync(join(root, 'data', 'custom', 'prompts', 'tasks', 'demo.md'), 'custom')

    await expect(loader.load('tasks/demo.md')).resolves.toBe('custom')
    expect(loader.isCustomized('tasks/demo.md')).toBe(true)
    expect(loader.getSource('tasks/demo.md')).toBe('custom')

    rmSync(join(root, 'data'), { recursive: true, force: true })
    await expect(loader.load('tasks/demo.md')).resolves.toBe('workshop')
    expect(loader.getSource('tasks/demo.md')).toBe('workshop')

    rmSync(join(root, 'workshop'), { recursive: true, force: true })
    await expect(loader.load('tasks/demo.md')).resolves.toBe('official')
    expect(loader.getSource('tasks/demo.md')).toBe('official')
  })

  it('应当在模板缺失时返回空字符串，并支持导出和恢复官方模板', async () => {
    const resolver = createResolver(root, false)
    const loader = new PromptTemplateLoader(resolver)
    // 官方路径与 promptTemplateLoader 当前实现对齐
    const officialDir = join(root, 'app', 'backend', 'src', 'services', 'mdp', 'prompts', 'tasks')
    mkdirSync(officialDir, { recursive: true })
    writeFileSync(join(officialDir, 'demo.md'), 'official')

    await expect(loader.load('missing.md')).resolves.toBe('')
    expect(loader.getSource('missing.md')).toBe('missing')

    const customPath = await loader.exportToCustom('tasks/demo.md')
    expect(readFileSync(customPath, 'utf-8')).toBe('official')
    expect(loader.isCustomized('tasks/demo.md')).toBe(true)
    await expect(loader.restoreToOfficial('tasks/demo.md')).resolves.toBe(true)
    await expect(loader.restoreToOfficial('tasks/demo.md')).resolves.toBe(false)
    await expect(loader.exportToCustom('missing.md')).rejects.toThrow(Error)
  })
})

describe('LogFileTransport', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `infos-log-${Date.now()}-${Math.random()}`)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('应当创建日志目录、写入日志并在超过大小后轮转', () => {
    const transport = new LogFileTransport({ logDir: root, maxFileSize: 5, prefix: 'test' })

    transport.write('第一行')
    const firstPath = transport.getLogPath()
    transport.write('第二行很长')
    const secondPath = transport.getLogPath()

    expect(transport.getLogDir()).toBe(root)
    expect(readFileSync(firstPath, 'utf-8')).toContain('第一行')
    expect(secondPath).not.toBe(firstPath)
    expect(readFileSync(secondPath, 'utf-8')).toContain('第二行很长')
  })

  it('应当清理超过保留天数的旧日志文件', () => {
    mkdirSync(root, { recursive: true })
    const oldFile = join(root, 'test-2000-01-01.log')
    const keepFile = join(root, 'other-2000-01-01.log')
    writeFileSync(oldFile, 'old')
    writeFileSync(keepFile, 'keep')
    const oldDate = new Date('2000-01-01T00:00:00.000Z')
    utimesSync(oldFile, oldDate, oldDate)
    utimesSync(keepFile, oldDate, oldDate)

    new LogFileTransport({ logDir: root, retentionDays: 1, prefix: 'test' })

    const files = readdirSync(root)
    expect(files).not.toContain('test-2000-01-01.log')
    expect(files).toContain('other-2000-01-01.log')
  })

  it('应当格式化日志级别、标签和结构化参数', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const line = formatLogLine(3, 'Test', '消息', [{ a: 1 }, null, '尾巴', circular])
    const unknown = formatLogLine(99, '', '普通', [])

    expect(line).toContain('[INFO]')
    expect(line).toContain('[Test]')
    expect(line).toContain('消息')
    expect(line).toContain('{"a":1}')
    expect(line).toContain('尾巴')
    expect(unknown).toContain('普通')
  })
})

describe('MemoryStoreRegistry', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `infos-store-${Date.now()}-${Math.random()}`)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('应当按 Agent 与来源创建并复用新版 TriviumDB Store', () => {
    const registry = new MemoryStoreRegistry(createResolver(root), 12)

    const main = registry.getAgentStore('pero', 'main')
    const sameMain = registry.getStoreBySource('pero', 'desktop')
    const group = registry.getStoreBySource('pero', 'group')
    const social = registry.getStoreBySource('pero', 'social')

    expect(main).toBe(sameMain)
    expect(group).toBe(main)
    expect(social).not.toBe(main)
    expect(registry.resolveAgentStorePath('pero', 'main')).toContain('memory.tdb')
    expect(registry.resolveAgentStorePath('pero', 'social')).toContain('social.tdb')
    registry.closeAll()
  })

  it('应当 flush、重建文本索引并返回 store 统计', () => {
    const registry = new MemoryStoreRegistry(createResolver(root), 4)
    const main = registry.getAgentStore('pero', 'main')
    const social = registry.getAgentStore('pero', 'social')
    main.commitTransaction([
      { type: 'insertWithId', id: 1, vector: [1, 0, 0, 0], payload: { text: '主记忆一' } },
      { type: 'insertWithId', id: 2, vector: [0, 1, 0, 0], payload: { text: '主记忆二' } },
    ])
    social.commitTransaction([
      { type: 'insertWithId', id: 1, vector: [1, 0, 0, 0], payload: { text: '社交记忆' } },
    ])

    registry.flushAll()
    registry.rebuildAllTextIndexes()
    const stats = registry.getStoreStats()
    registry.closeAll()

    expect(stats).toEqual([
      { path: expect.stringContaining('memory.tdb'), nodeCount: 2, memoryMB: expect.any(Number) },
      { path: expect.stringContaining('social.tdb'), nodeCount: 1, memoryMB: expect.any(Number) },
    ])
  })
})

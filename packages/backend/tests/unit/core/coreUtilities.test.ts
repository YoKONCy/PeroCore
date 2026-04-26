import { mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const triviumInstances: MockTriviumDB[] = []

class MockTriviumDB {
  path: string
  dim: number
  flush = vi.fn()
  buildTextIndex = vi.fn()
  nodeCount = vi.fn(() => 3)
  estimatedMemory = vi.fn(() => 2 * 1024 * 1024)
  enableAutoCompaction = vi.fn()
  setMemoryLimit = vi.fn()

  constructor(path: string, dim: number) {
    this.path = path
    this.dim = dim
    triviumInstances.push(this)
  }
}

vi.mock('triviumdb', () => ({
  TriviumDB: MockTriviumDB,
}))

import { HookRegistry } from '@perocore/backend/extensions/hookRegistry'
import { PromptTemplateLoader } from '@perocore/backend/core/promptTemplateLoader'
import { LogFileTransport, formatLogLine } from '@perocore/backend/lib/logFileTransport'
import { MemoryStoreRegistry } from '@perocore/backend/repositories/storeRegistry'
import type { PathResolver } from '@perocore/backend/core/pathResolver'

function createResolver(root: string, workshop = true): PathResolver {
  return {
    resolve: vi.fn((alias: string) =>
      join(
        root,
        alias
          .replace('@data/', 'data/')
          .replace('@workshop/', 'workshop/')
          .replace('@workshop', 'workshop')
          .replace('@app/', 'app/'),
      ),
    ),
    isAvailable: vi.fn((alias: string) => alias === '@workshop' && workshop),
  } as unknown as PathResolver
}

describe('HookRegistry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当按注册顺序串行执行 hook 并传递修改后的数据', async () => {
    const registry = new HookRegistry()
    const first = vi.fn((data: { value: number }) => ({ value: data.value + 1 }))
    const second = vi.fn((data: { value: number }) => ({ value: data.value * 2 }))

    registry.register('beforeChat' as never, 'ext-a', first as never)
    registry.register('beforeChat' as never, 'ext-b', second as never)
    const result = await registry.emit('beforeChat' as never, { value: 2 })

    expect(result).toEqual({ value: 6 })
    expect(first).toHaveBeenCalledWith({ value: 2 }, expect.any(Object))
    expect(second).toHaveBeenCalledWith({ value: 3 }, expect.any(Object))
    expect(registry.count).toBe(2)
    expect(registry.listHooks('beforeChat' as never)).toEqual(['ext-a', 'ext-b'])
  })

  it('应当支持 abort 中断后续 hook', async () => {
    const registry = new HookRegistry()
    const skipped = vi.fn()

    registry.register('beforeChat' as never, 'ext-a', ((
      _data: unknown,
      ctx: { abort: (reason: string) => void },
    ) => {
      ctx.abort('停止')
      return { value: 9 }
    }) as never)
    registry.register('beforeChat' as never, 'ext-b', skipped as never)

    await expect(registry.emit('beforeChat' as never, { value: 1 })).resolves.toEqual({ value: 9 })
    expect(skipped).not.toHaveBeenCalled()
  })

  it('应当吞掉单个 hook 异常并继续执行后续 hook', async () => {
    const registry = new HookRegistry()
    registry.register('beforeChat' as never, 'bad', (() => {
      throw new Error('失败')
    }) as never)
    registry.register('beforeChat' as never, 'good', (() => ({ ok: true })) as never)

    await expect(registry.emit('beforeChat' as never, { ok: false })).resolves.toEqual({ ok: true })
  })

  it('应当支持按扩展移除 hook 和清空全部 hook', () => {
    const registry = new HookRegistry()
    registry.register('beforeChat' as never, 'a', vi.fn() as never)
    registry.register('afterChat' as never, 'a', vi.fn() as never)
    registry.register('afterChat' as never, 'b', vi.fn() as never)

    registry.removeByExtension('a')
    expect(registry.count).toBe(1)
    expect(registry.listHooks('afterChat' as never)).toEqual(['b'])

    registry.clear()
    expect(registry.count).toBe(0)
  })
})

describe('PromptTemplateLoader', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `perocore-template-${Date.now()}-${Math.random()}`)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('应当按 custom、workshop、official 优先级加载模板并判断来源', async () => {
    const resolver = createResolver(root)
    const loader = new PromptTemplateLoader(resolver)
    mkdirSync(join(root, 'app', 'prompts', 'tasks'), { recursive: true })
    mkdirSync(join(root, 'workshop', 'prompts', 'tasks'), { recursive: true })
    mkdirSync(join(root, 'data', 'custom', 'prompts', 'tasks'), { recursive: true })
    writeFileSync(join(root, 'app', 'prompts', 'tasks', 'demo.md'), 'official')
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
    mkdirSync(join(root, 'app', 'prompts', 'tasks'), { recursive: true })
    writeFileSync(join(root, 'app', 'prompts', 'tasks', 'demo.md'), 'official')

    await expect(loader.load('missing.md')).resolves.toBe('')
    expect(loader.getSource('missing.md')).toBe('missing')

    const customPath = await loader.exportToCustom('tasks/demo.md')
    expect(readFileSync(customPath, 'utf-8')).toBe('official')
    expect(loader.isCustomized('tasks/demo.md')).toBe(true)
    await expect(loader.restoreToOfficial('tasks/demo.md')).resolves.toBe(true)
    await expect(loader.restoreToOfficial('tasks/demo.md')).resolves.toBe(false)
    await expect(loader.exportToCustom('missing.md')).rejects.toThrow('官方模板不存在')
  })
})

describe('LogFileTransport', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `perocore-log-${Date.now()}-${Math.random()}`)
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

    const transport = new LogFileTransport({ logDir: root, retentionDays: 1, prefix: 'test' })

    const files = readdirSync(root)
    expect(files).not.toContain('test-2000-01-01.log')
    expect(files).toContain('other-2000-01-01.log')
    expect(readFileSync(transport.getLogPath(), 'utf-8')).toContain('已清理 1 个过期日志文件')
  })

  it('应当格式化日志级别、标签和结构化参数', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const line = formatLogLine(3, 'Test', '消息', [{ a: 1 }, null, '尾巴', circular])
    const unknown = formatLogLine(99, '', '普通', [])

    expect(line).toContain('[INFO] [Test] 消息 {"a":1} 尾巴 [无法序列化]')
    expect(unknown).toContain('[LOG] 普通')
  })
})

describe('MemoryStoreRegistry', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `perocore-store-${Date.now()}-${Math.random()}`)
    triviumInstances.length = 0
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('应当按 agent、source 和 diary 创建并复用 TriviumDB store', () => {
    const registry = new MemoryStoreRegistry(createResolver(root), 12)

    const main = registry.getAgentStore('pero', 'main')
    const sameMain = registry.getStoreBySource('pero', 'desktop')
    const social = registry.getStoreBySource('pero', 'group_chat')
    const diary = registry.getDiaryStore()

    expect(main).toBe(sameMain)
    expect(social).not.toBe(main)
    expect(diary).not.toBe(main)
    expect(registry.resolveAgentStorePath('pero', 'main')).toContain('main.tdb')
    expect(registry.resolveAgentStorePath('pero', 'social')).toContain('social.tdb')
  })

  it('应当 flush、重建文本索引并返回 store 统计', () => {
    const registry = new MemoryStoreRegistry(createResolver(root))
    registry.getAgentStore('pero', 'main')
    registry.getAgentStore('pero', 'social')

    registry.flushAll()
    registry.rebuildAllTextIndexes()
    const stats = registry.getStoreStats()

    expect(stats).toEqual([
      { path: expect.stringContaining('main.tdb'), nodeCount: 0, memoryMB: 0 },
      { path: expect.stringContaining('social.tdb'), nodeCount: 0, memoryMB: 0 },
    ])
  })
})

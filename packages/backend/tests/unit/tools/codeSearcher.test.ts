import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __codeSearchInternals, resolveRipgrepPath } from '@infos/backend/tools/codeSearcher'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'infos-search-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'a.ts'), 'const alpha = 1\nconst target = alpha\n', 'utf8')
  await writeFile(path.join(root, 'src', 'b.js'), 'const target = 2\n', 'utf8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('code_search Node fallback', () => {
  it('按文件类型执行固定字符串搜索，返回行号与列号', async () => {
    const { matches, truncated } = await __codeSearchInternals.searchWithNode({
      query: 'target',
      isRegex: false,
      fileType: 'ts',
      searchPath: root,
    })
    expect(truncated).toBe(false)
    // 第 2 行 'const target = alpha'：'target' 从第 7 列开始（1-based）
    expect(matches).toEqual([
      expect.objectContaining({ file: path.join('src', 'a.ts'), line: 2, column: 7 }),
    ])
  })

  it('发行环境优先解析 resources 内置 rg', async () => {
    const resources = await mkdtemp(path.join(tmpdir(), 'infos-resources-'))
    const executable = process.platform === 'win32' ? 'rg.exe' : 'rg'
    const bundled = path.join(resources, 'bin', `${process.platform}-${process.arch}`, executable)
    await mkdir(path.dirname(bundled), { recursive: true })
    await writeFile(bundled, '')
    const previous = process.env.INFOS_RESOURCES_ROOT
    process.env.INFOS_RESOURCES_ROOT = resources
    try {
      expect(resolveRipgrepPath()).toBe(bundled)
      expect(existsSync(resolveRipgrepPath())).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.INFOS_RESOURCES_ROOT
      else process.env.INFOS_RESOURCES_ROOT = previous
      await rm(resources, { recursive: true, force: true })
    }
  })

  it('支持正则并拒绝无效表达式', async () => {
    const { matches } = await __codeSearchInternals.searchWithNode({
      query: 'alpha\\s*=\\s*1',
      isRegex: true,
      searchPath: root,
    })
    expect(matches).toHaveLength(1)
    expect(matches[0]!.column).toBe(7)
    expect(() => __codeSearchInternals.createMatcher('[', true)).toThrow('正则表达式无效')
  })

  it('匹配数超过结果上限时标记截断', async () => {
    await writeFile(
      path.join(root, 'many.txt'),
      Array.from({ length: 60 }, (_, i) => `hit ${i}`).join('\n') + '\n',
      'utf8',
    )
    const { matches, truncated } = await __codeSearchInternals.searchWithNode({
      query: 'hit',
      isRegex: false,
      searchPath: root,
    })
    expect(matches).toHaveLength(50)
    expect(truncated).toBe(true)
  })
})

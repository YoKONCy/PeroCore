/**
 * LocalWorkspaceService 单元测试
 *
 * 覆盖：
 * - getWorkspaceRoot
 * - ensureWorkspace 创建目录骨架
 * - validatePath（desktop read 全局 / desktop write 限 workspace / companion read 限 workspace / 路径逃逸 / @principal 前缀）
 * - resolveTerminalCwd（desktop 有/无 requestedCwd、companion 忽略 requestedCwd）
 * - read/write/list/stat 基本功能
 *
 * @module packages/backend/tests/unit/services/workspace/workspaceService.test
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PathResolver, type RuntimeEnv } from '@infos/backend/core/pathResolver'
import { LocalWorkspaceService } from '@infos/backend/services/workspace/workspaceService'

const AGENT_ID = 'pero'

describe('LocalWorkspaceService', () => {
  let rootDir: string
  let dataDir: string
  let appDir: string
  let tempDir: string
  let service: LocalWorkspaceService

  beforeEach(() => {
    rootDir = path.join(tmpdir(), `infos-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    dataDir = path.join(rootDir, 'data')
    appDir = path.join(rootDir, 'app')
    tempDir = path.join(rootDir, 'temp')
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(appDir, { recursive: true })
    mkdirSync(tempDir, { recursive: true })

    const env: RuntimeEnv = {
      appRoot: appDir,
      dataDir,
      tempDir,
      workshopDir: '',
    }
    const pathResolver = new PathResolver(env)
    service = new LocalWorkspaceService(pathResolver)
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  // ── getWorkspaceRoot ──

  it('getWorkspaceRoot 应当返回 @data/principals/{agentId}/workspace', () => {
    const root = service.getWorkspaceRoot(AGENT_ID)
    expect(root).toBe(path.resolve(dataDir, 'principals', AGENT_ID, 'workspace'))
  })

  // ── ensureWorkspace ──

  it('ensureWorkspace 应当只创建 workspace 根目录，业务子目录按需懒创建', async () => {
    const root = service.getWorkspaceRoot(AGENT_ID)
    expect(existsSync(root)).toBe(false)

    await service.ensureWorkspace(AGENT_ID)

    expect(existsSync(root)).toBe(true)
    for (const subdir of ['inbox', 'notes', 'diary', 'drafts']) {
      expect(existsSync(path.join(root, subdir))).toBe(false)
    }
  })

  it('ensureWorkspace 应当幂等（重复调用不报错）', async () => {
    await service.ensureWorkspace(AGENT_ID)
    await expect(service.ensureWorkspace(AGENT_ID)).resolves.toBeUndefined()
  })

  // ── validatePath ──

  describe('validatePath', () => {
    beforeEach(async () => {
      await service.ensureWorkspace(AGENT_ID)
    })

    it('desktop channel + read 应当全局允许（含 workspace 外路径）', () => {
      const outsidePath = path.join(rootDir, 'outside-file.txt')
      writeFileSync(outsidePath, 'x', 'utf-8')
      const result = service.validatePath(AGENT_ID, outsidePath, 'read', 'desktop')
      expect(result.allowed).toBe(true)
      expect(result.resolvedPath).toBe(outsidePath)
    })

    it('desktop channel + write 应当限定 workspace（workspace 内允许）', () => {
      const result = service.validatePath(AGENT_ID, 'notes/diary.md', 'write', 'desktop')
      expect(result.allowed).toBe(true)
      expect(result.resolvedPath).toBe(
        path.resolve(service.getWorkspaceRoot(AGENT_ID), 'notes', 'diary.md'),
      )
    })

    it('desktop channel + write 应当拒绝 workspace 外路径', () => {
      const outsidePath = path.join(rootDir, 'outside-write.txt')
      const result = service.validatePath(AGENT_ID, outsidePath, 'write', 'desktop')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('逃逸')
    })

    it('companion channel + read 应当限定 workspace（拒绝 workspace 外路径）', () => {
      const outsidePath = path.join(rootDir, 'outside-read.txt')
      writeFileSync(outsidePath, 'x', 'utf-8')
      const result = service.validatePath(AGENT_ID, outsidePath, 'read', 'companion')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('逃逸')
    })

    it('companion channel + read 应当允许 workspace 内路径', () => {
      const result = service.validatePath(AGENT_ID, 'notes/diary.md', 'read', 'companion')
      expect(result.allowed).toBe(true)
    })

    it('应当拒绝路径逃逸（../ 出 workspace）', () => {
      const escapePath = '../../../etc/passwd'
      const result = service.validatePath(AGENT_ID, escapePath, 'read', 'companion')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('逃逸')
    })

    it('应当解析 @principal 前缀到 workspace 内路径', () => {
      const result = service.validatePath(
        AGENT_ID,
        '@principal/notes/diary.md',
        'read',
        'companion',
      )
      expect(result.allowed).toBe(true)
      expect(result.resolvedPath).toBe(
        path.resolve(service.getWorkspaceRoot(AGENT_ID), 'notes', 'diary.md'),
      )
    })

    it('未知 channel 应当回退到最严格策略（限 workspace）', () => {
      const outsidePath = path.join(rootDir, 'unknown-channel.txt')
      writeFileSync(outsidePath, 'x', 'utf-8')
      const result = service.validatePath(AGENT_ID, outsidePath, 'read', 'unknown-channel')
      expect(result.allowed).toBe(false)
    })
  })

  // ── resolveTerminalCwd ──

  describe('resolveTerminalCwd', () => {
    beforeEach(async () => {
      await service.ensureWorkspace(AGENT_ID)
    })

    it('desktop channel + 有 requestedCwd（存在的目录）→ 使用 requestedCwd', () => {
      const requestedCwd = path.join(rootDir, 'custom-cwd')
      mkdirSync(requestedCwd, { recursive: true })
      const result = service.resolveTerminalCwd(AGENT_ID, requestedCwd, 'desktop')
      expect(result).toBe(requestedCwd)
    })

    it('desktop channel + 无 requestedCwd → 使用 workspace root', () => {
      const result = service.resolveTerminalCwd(AGENT_ID, undefined, 'desktop')
      expect(result).toBe(service.getWorkspaceRoot(AGENT_ID))
    })

    it('desktop channel + requestedCwd 不存在 → 回退 workspace root', () => {
      const requestedCwd = path.join(rootDir, 'does-not-exist')
      const result = service.resolveTerminalCwd(AGENT_ID, requestedCwd, 'desktop')
      expect(result).toBe(service.getWorkspaceRoot(AGENT_ID))
    })

    it('companion channel + 有 requestedCwd → 忽略，使用 workspace root', () => {
      const requestedCwd = path.join(rootDir, 'custom-cwd')
      mkdirSync(requestedCwd, { recursive: true })
      const result = service.resolveTerminalCwd(AGENT_ID, requestedCwd, 'companion')
      expect(result).toBe(service.getWorkspaceRoot(AGENT_ID))
    })

    it('未知 channel → 使用 workspace root（最严格策略）', () => {
      const requestedCwd = path.join(rootDir, 'custom-cwd')
      mkdirSync(requestedCwd, { recursive: true })
      const result = service.resolveTerminalCwd(AGENT_ID, requestedCwd, 'unknown-channel')
      expect(result).toBe(service.getWorkspaceRoot(AGENT_ID))
    })
  })

  // ── read / write / list / stat 基本功能 ──

  describe('文件操作基本功能', () => {
    beforeEach(async () => {
      await service.ensureWorkspace(AGENT_ID)
    })

    it('write + read 应当往返一致', async () => {
      const content = '喵喵日记内容'
      await service.write(AGENT_ID, 'notes/diary.md', content, 'desktop')

      const read = await service.read(AGENT_ID, 'notes/diary.md', 'desktop')
      expect(read).toBe(content)
    })

    it('write append 应当追加而非覆盖', async () => {
      await service.write(AGENT_ID, 'notes/log.txt', '第一行\n', 'desktop')
      await service.write(AGENT_ID, 'notes/log.txt', '第二行\n', 'desktop', { append: true })

      const read = await service.read(AGENT_ID, 'notes/log.txt', 'desktop')
      expect(read).toBe('第一行\n第二行\n')
    })

    it('list 应当列出目录条目', async () => {
      await service.write(AGENT_ID, 'notes/a.md', 'a', 'desktop')
      await service.write(AGENT_ID, 'notes/b.md', 'b', 'desktop')

      const entries = await service.list(AGENT_ID, 'notes', 'desktop')
      const names = entries.map((e) => e.name).sort()
      expect(names).toEqual(['a.md', 'b.md'])
      expect(entries[0]).toHaveProperty('isDirectory', false)
      expect(entries[0]).toHaveProperty('size')
      expect(entries[0]).toHaveProperty('modifiedAt')
    })

    it('stat 应当返回文件元信息', async () => {
      await service.write(AGENT_ID, 'notes/diary.md', '内容', 'desktop')

      const stat = await service.stat(AGENT_ID, 'notes/diary.md', 'desktop')
      expect(stat.exists).toBe(true)
      expect(stat.isFile).toBe(true)
      expect(stat.isDirectory).toBe(false)
      expect(stat.size).toBeGreaterThan(0)
      expect(stat.modifiedAt).toBeInstanceOf(Date)
    })

    it('stat 不存在的路径应当返回 exists=false', async () => {
      const stat = await service.stat(AGENT_ID, 'notes/missing.md', 'desktop')
      expect(stat.exists).toBe(false)
      expect(stat.isFile).toBe(false)
      expect(stat.modifiedAt).toBeNull()
    })

    it('read 不存在的文件应当抛错', async () => {
      await expect(service.read(AGENT_ID, 'notes/missing.md', 'desktop')).rejects.toThrow(
        '文件不存在',
      )
    })

    it('companion channel write workspace 外路径应当抛错', async () => {
      await expect(
        service.write(AGENT_ID, path.join(rootDir, 'escape.txt'), 'x', 'companion'),
      ).rejects.toThrow('逃逸')
    })

    it('read 应当截断超长内容', async () => {
      const longContent = 'x'.repeat(20_000)
      await service.write(AGENT_ID, 'notes/long.txt', longContent, 'desktop')

      const read = await service.read(AGENT_ID, 'notes/long.txt', 'desktop', { maxLength: 100 })
      expect(read.length).toBeLessThan(longContent.length)
      expect(read).toContain('截断')
    })
  })

  // ── @principal 路径往返 ──

  it('@principal 前缀路径应当正确解析并可读写', async () => {
    await service.ensureWorkspace(AGENT_ID)
    await service.write(AGENT_ID, '@principal/notes/principal.md', '主路径', 'companion')

    // 通过 validatePath 验证解析结果
    const check = service.validatePath(
      AGENT_ID,
      '@principal/notes/principal.md',
      'read',
      'companion',
    )
    expect(check.allowed).toBe(true)
    expect(readFileSync(check.resolvedPath, 'utf-8')).toBe('主路径')
  })
})

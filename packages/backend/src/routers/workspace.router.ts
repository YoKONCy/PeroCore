import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import { getProductivityRuntime, resolveExecutionSession } from '../tools/productivityRuntimeHolder'
import { __codeSearchInternals } from '../tools/codeSearcher'

const sessionSchema = z.object({
  agentId: z.string().min(1),
  threadId: z.string().min(1),
})

const readSchema = sessionSchema.extend({
  path: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(128_000).optional(),
  lineStart: z.number().int().min(1).optional(),
  lineEnd: z.number().int().min(1).optional(),
  tailLines: z.number().int().min(1).max(10_000).optional(),
})

const writeSchema = sessionSchema.extend({
  path: z.string().min(1),
  content: z.string(),
  expectedHash: z.string().optional(),
})

const renameSchema = sessionSchema.extend({
  path: z.string().min(1),
  newName: z.string().trim().min(1).max(255),
})

const deleteSchema = sessionSchema.extend({
  path: z.string().min(1),
})

const searchSchema = sessionSchema.extend({
  query: z.string().min(1),
  isRegex: z.boolean().optional(),
  fileType: z.string().optional(),
  path: z.string().optional(),
})

export interface WorkspaceTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: string
}

/** Workspace 浏览器 API：严格绑定 Agent 的执行会话根目录，优先使用受控 VirtualWorkspace。 */
export function createWorkspaceRouter(ctx: AppContext) {
  const router = new Hono()

  /** 目录树（单层懒加载，前端点目录再深入） */
  router.get(
    '/tree',
    zValidator('query', sessionSchema.extend({ path: z.string().optional() })),
    async (c) => {
      const query = c.req.valid('query')
      const session = await resolve(query.agentId, query.threadId)
      const relative = query.path ?? '.'
      const directory = await getProductivityRuntime().virtualWorkspace.resolveDirectory(
        session,
        relative,
      )
      const info = await stat(directory).catch(() => null)
      if (!info?.isDirectory())
        throw new AppError('NOT_FOUND', { message: `目录不存在: ${relative}` })
      const entries = await readdir(directory, { withFileTypes: true })
      const nodes: WorkspaceTreeNode[] = []
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const absolute = path.join(directory, entry.name)
        const childInfo = entry.isFile() ? await stat(absolute).catch(() => null) : null
        nodes.push({
          name: entry.name,
          path: path.posix.join(relative.replaceAll('\\', '/').replace(/^\.\/?$/, ''), entry.name),
          type: entry.isDirectory() ? 'directory' : 'file',
          size: childInfo?.size,
          modifiedAt: childInfo?.mtime.toISOString(),
        })
      }
      nodes.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
      )
      return c.json({ code: 'OK', data: { root: session.workspaceRoot, parent: relative, nodes } })
    },
  )

  /**
   * 返回经过 ExecutionSession 安全解析的真实 workspace 根目录。
   * Electron 客户端在自身桌面会话中打开本地路径；纯 Web/远程模式可请求执行节点代为打开。
   */
  router.post(
    '/reveal',
    zValidator('json', sessionSchema.extend({ openOnNode: z.boolean().optional() })),
    async (c) => {
      const input = c.req.valid('json')
      const session = await resolve(input.agentId, input.threadId)
      if (input.openOnNode) await ctx.systemService.openTrustedPath(session.workspaceRoot)
      return c.json({
        code: 'OK',
        data: {
          path: session.workspaceRoot,
          platform: process.platform,
          location: 'execution-node',
        },
      })
    },
  )

  /** 范围读取（行/字节/tail，含 hash 与截断状态） */
  router.post('/read', zValidator('json', readSchema), async (c) => {
    const input = c.req.valid('json')
    const session = await resolve(input.agentId, input.threadId)
    try {
      const result = await getProductivityRuntime().virtualWorkspace.read(session, input.path, {
        offset: input.offset,
        limit: input.limit,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
        tailLines: input.tailLines,
      })
      return c.json({ code: 'OK', data: result })
    } catch (error) {
      throw new AppError('VALIDATION_ERROR', {
        message: String(error instanceof Error ? error.message : error),
      })
    }
  })

  /** 全量原子写（VirtualWorkspace.atomicWrite，可带 hash 乐观锁） */
  router.post('/write', zValidator('json', writeSchema), async (c) => {
    const input = c.req.valid('json')
    const session = await resolve(input.agentId, input.threadId)
    const runtime = getProductivityRuntime().virtualWorkspace
    try {
      const result = await runtime.write(session, {
        path: input.path,
        content: input.content,
        expectedHash: input.expectedHash,
      })
      return c.json({
        code: 'OK',
        data: {
          hash: result.newHash,
          bytes: result.bytes,
          operation: result.operation,
          editRange: result.editRange,
          insertions: result.insertions,
          deletions: result.deletions,
        },
      })
    } catch (error) {
      throw new AppError('VALIDATION_ERROR', {
        message: String(error instanceof Error ? error.message : error),
      })
    }
  })

  /** 重命名普通文件（固定在原目录，禁止覆盖同名文件） */
  router.post('/rename', zValidator('json', renameSchema), async (c) => {
    const input = c.req.valid('json')
    const session = await resolve(input.agentId, input.threadId)
    try {
      const result = await getProductivityRuntime().virtualWorkspace.renameFile(
        session,
        input.path,
        input.newName,
      )
      return c.json({ code: 'OK', data: result })
    } catch (error) {
      throw new AppError('VALIDATION_ERROR', {
        message: String(error instanceof Error ? error.message : error),
      })
    }
  })

  /** 删除普通文件；不允许递归删除目录 */
  router.post('/delete', zValidator('json', deleteSchema), async (c) => {
    const input = c.req.valid('json')
    const session = await resolve(input.agentId, input.threadId)
    try {
      const result = await getProductivityRuntime().virtualWorkspace.deleteFile(session, input.path)
      return c.json({ code: 'OK', data: result })
    } catch (error) {
      throw new AppError('VALIDATION_ERROR', {
        message: String(error instanceof Error ? error.message : error),
      })
    }
  })

  /** rg 搜索（无 rg 自动 Node fallback，目录强制在 workspace 内） */
  router.post('/search', zValidator('json', searchSchema), async (c) => {
    const input = c.req.valid('json')
    const session = await resolve(input.agentId, input.threadId)
    const searchPath = input.path
      ? await getProductivityRuntime().virtualWorkspace.resolveDirectory(session, input.path)
      : await getProductivityRuntime().virtualWorkspace.resolveDirectory(session, '.')
    try {
      const rg = await __codeSearchInternals.searchWithRipgrep({
        query: input.query,
        isRegex: Boolean(input.isRegex),
        fileType: input.fileType,
        searchPath,
      })
      // Node fallback 仅在 rg 不可用时执行
      const node = rg.available
        ? null
        : await __codeSearchInternals.searchWithNode({
            query: input.query,
            isRegex: Boolean(input.isRegex),
            fileType: input.fileType,
            searchPath,
          })
      return c.json({
        code: 'OK',
        data: {
          matches: rg.available ? rg.matches : node!.matches,
          total: rg.available ? rg.matches.length : node!.matches.length,
          truncated: rg.available ? rg.truncated : node!.truncated,
          engine: rg.available ? 'ripgrep' : 'node-fallback',
        },
      })
    } catch (error) {
      throw new AppError('VALIDATION_ERROR', {
        message: String(error instanceof Error ? error.message : error),
      })
    }
  })

  return router
}

async function resolve(agentId: string, threadId: string) {
  return resolveExecutionSession({ agentId, threadId, channel: 'desktop' })
}

/**
 * workspaceBrowserService — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { AppError } from '../../lib/appError'
import type { ProductivityRuntime } from '../../tools/productivityRuntimeHolder'
import { __codeSearchInternals } from '../../tools/codeSearcher'

export interface WorkspaceTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: string
}

/** Workspace浏览与搜索用例层；封装文件系统和搜索引擎基础设施。 */
export class WorkspaceBrowserService {
  constructor(private readonly runtime: ProductivityRuntime) {}

  async session(agentId: string, threadId: string) {
    const workspaceRoot = this.runtime.workspace.getWorkspaceRoot(agentId)
    return this.runtime.sessions.getOrCreate({
      ownerAgentId: agentId,
      threadId,
      channel: 'desktop',
      workspaceRoot,
    })
  }

  async tree(
    agentId: string,
    threadId: string,
    relative = '.',
  ): Promise<{
    root: string
    parent: string
    nodes: WorkspaceTreeNode[]
  }> {
    const session = await this.session(agentId, threadId)
    const directory = await this.runtime.virtualWorkspace.resolveDirectory(session, relative)
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
    return { root: session.workspaceRoot, parent: relative, nodes }
  }

  async search(input: {
    agentId: string
    threadId: string
    query: string
    isRegex?: boolean
    fileType?: string
    path?: string
  }) {
    const session = await this.session(input.agentId, input.threadId)
    const searchPath = await this.runtime.virtualWorkspace.resolveDirectory(
      session,
      input.path ?? '.',
    )
    const options = {
      query: input.query,
      isRegex: Boolean(input.isRegex),
      fileType: input.fileType,
      searchPath,
    }
    const rg = await __codeSearchInternals.searchWithRipgrep(options)
    const node = rg.available ? null : await __codeSearchInternals.searchWithNode(options)
    const matches = rg.available ? rg.matches : node!.matches
    return {
      matches,
      total: matches.length,
      truncated: rg.available ? rg.truncated : node!.truncated,
      engine: rg.available ? 'ripgrep' : 'node-fallback',
    }
  }
}

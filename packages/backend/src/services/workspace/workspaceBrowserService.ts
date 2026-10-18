/**
 * workspaceBrowserService — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import path from 'node:path'
import { open, readdir, stat } from 'node:fs/promises'
import type { WorkspaceFileDescriptor } from '@infos/shared'
import { AppError } from '../../lib/appError'
import type { ProductivityRuntime } from '../../tools/productivityRuntimeHolder'
import { __codeSearchInternals } from '../../tools/codeSearcher'
import type { ThreadService } from '../thread/threadService'
import { workspaceFileType } from './workspaceFileType'

export interface WorkspaceTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: string
}

/** Workspace浏览与搜索用例层；封装文件系统和搜索引擎基础设施。 */
export class WorkspaceBrowserService {
  constructor(
    private readonly runtime: ProductivityRuntime,
    private readonly threads?: ThreadService,
  ) {}

  async session(agentId: string, threadId: string) {
    if (this.threads) {
      const thread = await this.threads.getThread(threadId)
      if (!thread || thread.agentId !== agentId || thread.channel !== 'desktop') {
        throw new AppError('FORBIDDEN', { message: '工作区会话与角色不匹配' })
      }
    }
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

  /** 浏览器只解析当前工作区的真实文件，二进制内容不经过文本读取或模型。 */
  async file(agentId: string, threadId: string, inputPath: string) {
    const session = await this.session(agentId, threadId)
    const filePath = await this.runtime.virtualWorkspace.resolveReadablePath(session, inputPath)
    const handle = await open(filePath, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile()) throw new AppError('VALIDATION_ERROR', { message: '目标不是普通文件' })
      const header = Buffer.alloc(Math.min(info.size, 8192))
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      const descriptor: WorkspaceFileDescriptor = {
        path: inputPath,
        name: path.basename(filePath),
        ...workspaceFileType(filePath, header.subarray(0, bytesRead)),
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        version: `${info.size}-${info.mtimeMs}-${info.ctimeMs}`,
      }
      return { filePath, descriptor }
    } finally {
      await handle.close()
    }
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

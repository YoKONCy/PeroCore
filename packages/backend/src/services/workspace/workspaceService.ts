/**
 * WorkspaceService — Agent 个人文件空间服务
 *
 * 职责：
 * 1. 提供 Principal Workspace 的文件操作（read/write/list/stat）
 * 2. Containment 检查（防止路径逃逸）
 * 3. 按 channel 分级控制文件访问范围
 * 4. 为第七阶段 Daemon 独立预留 RPC 扩展点
 *
 * 设计：
 * - 抽象接口 WorkspaceService，第四阶段实现 LocalWorkspaceService
 * - 第七阶段可加 RemoteWorkspaceService（走 WebSocket RPC）
 * - 文件工具只依赖接口，不依赖具体实现
 *
 * @module packages/backend/src/services/workspace/workspaceService
 */

import path from 'node:path'
import {
  readFileSync,
  writeFileSync,
  statSync,
  lstatSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  appendFileSync,
  rmSync,
} from 'node:fs'
import type { PathResolver } from '../../core/pathResolver'
import { createLogger } from '../../lib/logger'

const logger = createLogger('WorkspaceService')

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 文件访问模式 */
export type FileAccessMode = 'read' | 'write'

/** Containment 检查结果 */
export interface ContainmentResult {
  /** 是否允许访问 */
  allowed: boolean
  /** 规范化后的绝对路径 */
  resolvedPath: string
  /** 拒绝原因（allowed=false 时有值） */
  reason?: string
}

/** 目录条目 */
export interface DirEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: Date
}

/** 文件元信息 */
export interface FileStat {
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  size: number
  modifiedAt: Date | null
}

/** 读取文件选项 */
export interface ReadOptions {
  /** 仅供白名单内纯只读工具显式请求设备级路径。 */
  deviceScope?: boolean
  /** 显式指定最大读取字符数；未指定时默认读取前 800 行。 */
  maxLength?: number
}

/** 写入文件选项 */
export interface WriteOptions {
  /** 是否追加（默认 false） */
  append?: boolean
  /** 仅限已经逐次审批的工具调用写入设备路径。 */
  deviceScope?: boolean
}

// ─────────────────────────────────────────────
// Channel 文件策略
// ─────────────────────────────────────────────

/**
 * Channel 文件访问策略
 *
 * 按 channel 分级控制文件工具的访问范围：
 * - desktop：read 全局可读（帮用户看代码），write 限 workspace，terminal cwd 可授权指定
 * - social/group：读写都限 workspace，terminal cwd 限 workspace
 */
export interface ChannelFilePolicy {
  /** 读操作范围：workspace=仅 workspace，global=全局可读 */
  readScope: 'workspace' | 'global'
  /** 写操作范围：workspace=仅 workspace，global=全局可写（不推荐） */
  writeScope: 'workspace' | 'global'
  /** terminal cwd 策略：workspace=只能 workspace，authorized=可授权指定 */
  terminalCwd: 'workspace' | 'authorized'
}

/** 各 channel 的默认文件策略 */
export const CHANNEL_FILE_POLICIES: Record<string, ChannelFilePolicy> = {
  /** 桌面端：read 全局，write 限 workspace，terminal 可授权指定 cwd */
  desktop: {
    readScope: 'global',
    writeScope: 'workspace',
    terminalCwd: 'authorized',
  },
  /** 社交模式：全部限 workspace */
  social: {
    readScope: 'workspace',
    writeScope: 'workspace',
    terminalCwd: 'workspace',
  },
  /** 群聊模式：全部限 workspace */
  group: {
    readScope: 'workspace',
    writeScope: 'workspace',
    terminalCwd: 'workspace',
  },
}

/**
 * 获取指定 channel 的文件策略
 *
 * 未知 channel 回退到最严格策略（全部限 workspace）。
 */
export function getChannelFilePolicy(channel: string): ChannelFilePolicy {
  return (
    CHANNEL_FILE_POLICIES[channel] ?? {
      readScope: 'workspace',
      writeScope: 'workspace',
      terminalCwd: 'workspace',
    }
  )
}

// ─────────────────────────────────────────────
// WorkspaceService 抽象接口
// ─────────────────────────────────────────────

/**
 * WorkspaceService 抽象接口
 *
 * 第四阶段实现 LocalWorkspaceService（本地 fs 操作）。
 * 第七阶段可加 RemoteWorkspaceService（走 WebSocket RPC）。
 */
export interface WorkspaceService {
  /** 获取 Agent 的 workspace 根目录 */
  getWorkspaceRoot(agentId: string): string

  /** 确保 workspace 目录存在（含子目录骨架） */
  ensureWorkspace(agentId: string): Promise<void>

  /** 解析相对路径为 workspace 内的绝对路径 */
  resolve(agentId: string, relativePath: string): string

  /**
   * Containment 检查
   *
   * 检查目标路径是否在允许的范围内：
   * - policy 为 workspace 时，路径必须在 workspace 内
   * - policy 为 global 时，允许任意路径（但仍会规范化）
   *
   * @param agentId Agent ID
   * @param targetPath 目标路径（可能是相对路径、绝对路径、或 @principal 前缀）
   * @param mode 访问模式（read/write）
   * @param channel 对话通道（决定策略）
   */
  validatePath(
    agentId: string,
    targetPath: string,
    mode: FileAccessMode,
    channel: string,
  ): ContainmentResult

  /** 读取文件 */
  read(agentId: string, filePath: string, channel: string, options?: ReadOptions): Promise<string>

  /** 写入文件 */
  write(
    agentId: string,
    filePath: string,
    content: string,
    channel: string,
    options?: WriteOptions,
  ): Promise<void>

  /** 删除普通文件；不递归删除目录。 */
  deleteFile(
    agentId: string,
    filePath: string,
    channel: string,
    options?: { deviceScope?: boolean },
  ): Promise<void>

  /** 列出目录 */
  list(
    agentId: string,
    dirPath: string,
    channel: string,
    options?: { deviceScope?: boolean },
  ): Promise<DirEntry[]>

  /** 获取文件/目录信息 */
  stat(
    agentId: string,
    targetPath: string,
    channel: string,
    options?: { deviceScope?: boolean },
  ): Promise<FileStat>

  /** 解析纯只读工具的设备路径；相对路径仍基于 Workspace。 */
  resolveDeviceReadPath(agentId: string, requestedPath?: string): string

  /**
   * 解析 terminal cwd
   *
   * - 默认返回 workspace root
   * - 如果 requestedCwd 提供 且 channel 策略允许，返回 requestedCwd
   */
  resolveTerminalCwd(agentId: string, requestedCwd: string | undefined, channel: string): string
}

// ─────────────────────────────────────────────
// LocalWorkspaceService 实现
// ─────────────────────────────────────────────

/** full 读取默认最多返回的行数。 */
const DEFAULT_READ_LINES = 800

/** 单文件最大读取字节 (10MB) */
const MAX_READ_SIZE = 10 * 1024 * 1024

export class LocalWorkspaceService implements WorkspaceService {
  constructor(private pathResolver: PathResolver) {}

  getWorkspaceRoot(agentId: string): string {
    // @principal → @data/principals/{agentId}/workspace/
    const dataRoot = this.pathResolver.getRoot('@data')!
    return path.resolve(dataRoot, 'principals', agentId, 'workspace')
  }

  /** 确保 workspace 根目录存在（子目录按需懒创建，不再预置空骨架）。 */
  async ensureWorkspace(agentId: string): Promise<void> {
    const root = this.getWorkspaceRoot(agentId)
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true })
      logger.info(`创建 workspace: ${root}`)
    }
  }

  resolve(agentId: string, relativePath: string): string {
    const root = this.getWorkspaceRoot(agentId)
    return path.resolve(root, relativePath)
  }

  validatePath(
    agentId: string,
    targetPath: string,
    mode: FileAccessMode,
    channel: string,
  ): ContainmentResult {
    const policy = getChannelFilePolicy(channel)
    const scope = mode === 'read' ? policy.readScope : policy.writeScope
    const workspaceRoot = this.getWorkspaceRoot(agentId)

    // 解析目标路径
    let resolvedPath: string
    if (targetPath.startsWith('@principal/')) {
      // @principal 前缀 → workspace 内相对路径
      const relativePart = targetPath.slice('@principal/'.length)
      resolvedPath = path.resolve(workspaceRoot, relativePart)
    } else if (path.isAbsolute(targetPath)) {
      resolvedPath = targetPath
    } else {
      // 相对路径 → 相对于 workspace
      resolvedPath = path.resolve(workspaceRoot, targetPath)
    }

    // global scope 直接允许（仅规范化路径）
    if (scope === 'global') {
      return { allowed: true, resolvedPath }
    }

    // workspace scope: containment 检查
    // 1. 尝试 realpath 解析软链接和 junction（路径不存在时回退到原路径）
    let realPath: string
    try {
      realPath = realpathSync(resolvedPath)
    } catch {
      // 路径不存在（可能是写操作的目标），用 resolve 规范化
      realPath = path.resolve(resolvedPath)
    }

    // 同时解析 workspace root（防止 workspace 本身是软链接）
    let realWorkspaceRoot: string
    try {
      realWorkspaceRoot = realpathSync(workspaceRoot)
    } catch {
      realWorkspaceRoot = workspaceRoot
    }

    // 2. 计算 relative 路径
    const relative = path.relative(realWorkspaceRoot, realPath)

    // 3. 如果以 '..' 开头或为绝对路径 → 逃逸，拒绝
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return {
        allowed: false,
        resolvedPath: realPath,
        reason: `路径逃逸出 workspace: ${targetPath} → ${realPath}（channel=${channel} 不允许访问 workspace 外路径）`,
      }
    }

    // 4. 检查盘符和 UNC 路径（Windows）
    if (process.platform === 'win32') {
      // 检查 UNC 路径（\\server\share）
      if (realPath.startsWith('\\\\')) {
        return {
          allowed: false,
          resolvedPath: realPath,
          reason: `不允许访问 UNC 路径: ${realPath}`,
        }
      }
    }

    return { allowed: true, resolvedPath: realPath }
  }

  async read(
    agentId: string,
    filePath: string,
    channel: string,
    options?: ReadOptions,
  ): Promise<string> {
    const check = options?.deviceScope
      ? { allowed: true, resolvedPath: this.resolveDeviceReadPath(agentId, filePath) }
      : this.validatePath(agentId, filePath, 'read', channel)
    if (!check.allowed) {
      throw new Error(check.reason)
    }

    if (!existsSync(check.resolvedPath)) {
      throw new Error(`文件不存在: ${filePath}`)
    }

    const stat = statSync(check.resolvedPath)
    if (!stat.isFile()) {
      throw new Error(`路径不是文件: ${filePath}`)
    }
    if (stat.size > MAX_READ_SIZE) {
      throw new Error(`文件过大 (${stat.size} bytes)，上限 10MB`)
    }

    // 尝试 UTF-8，失败后尝试 latin1
    let content: string
    try {
      content = readFileSync(check.resolvedPath, 'utf-8')
    } catch {
      content = readFileSync(check.resolvedPath, 'latin1')
    }

    if (options?.maxLength !== undefined) {
      if (content.length > options.maxLength) {
        return content.slice(0, options.maxLength) + '\n...[内容已截断]...'
      }
      return content
    }

    const lines = content.split(/\r?\n/)
    if (lines.length > DEFAULT_READ_LINES) {
      return lines.slice(0, DEFAULT_READ_LINES).join('\n') + '\n...[内容已截断]...'
    }
    return content
  }

  async write(
    agentId: string,
    filePath: string,
    content: string,
    channel: string,
    options?: WriteOptions,
  ): Promise<void> {
    const check = options?.deviceScope
      ? { allowed: true, resolvedPath: this.resolveDeviceReadPath(agentId, filePath) }
      : this.validatePath(agentId, filePath, 'write', channel)
    if (!check.allowed) {
      throw new Error(check.reason)
    }

    // 确保父目录存在
    const dir = path.dirname(check.resolvedPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    if (options?.append) {
      appendFileSync(check.resolvedPath, content, 'utf-8')
    } else {
      writeFileSync(check.resolvedPath, content, 'utf-8')
    }
  }

  async deleteFile(
    agentId: string,
    filePath: string,
    channel: string,
    options?: { deviceScope?: boolean },
  ): Promise<void> {
    const check = options?.deviceScope
      ? { allowed: true, resolvedPath: this.resolveDeviceReadPath(agentId, filePath) }
      : this.validatePath(agentId, filePath, 'write', channel)
    if (!check.allowed) throw new Error(check.reason)
    if (!existsSync(check.resolvedPath)) throw new Error(`文件不存在: ${filePath}`)
    const lexicalStat = lstatSync(check.resolvedPath)
    if (lexicalStat.isSymbolicLink()) throw new Error(`不允许删除符号链接或 Junction: ${filePath}`)

    const actual = realpathSync(check.resolvedPath)
    const stat = statSync(actual)
    if (!stat.isFile()) throw new Error(`路径不是普通文件: ${filePath}`)
    rmSync(actual)
  }

  async list(
    agentId: string,
    dirPath: string,
    channel: string,
    options?: { deviceScope?: boolean },
  ): Promise<DirEntry[]> {
    const check: ContainmentResult = options?.deviceScope
      ? { allowed: true, resolvedPath: this.resolveDeviceReadPath(agentId, dirPath) }
      : this.validatePath(agentId, dirPath, 'read', channel)
    if (!check.allowed) {
      throw new Error(check.reason)
    }

    if (!existsSync(check.resolvedPath)) {
      throw new Error(`目录不存在: ${dirPath}`)
    }

    const stat = statSync(check.resolvedPath)
    if (!stat.isDirectory()) {
      throw new Error(`路径不是目录: ${dirPath}`)
    }

    const entries = readdirSync(check.resolvedPath)
    return entries.map((name) => {
      const fullPath = path.join(check.resolvedPath, name)
      const entryStat = statSync(fullPath)
      return {
        name,
        isDirectory: entryStat.isDirectory(),
        size: entryStat.size,
        modifiedAt: entryStat.mtime,
      }
    })
  }

  async stat(
    agentId: string,
    targetPath: string,
    channel: string,
    options?: { deviceScope?: boolean },
  ): Promise<FileStat> {
    const check = options?.deviceScope
      ? { allowed: true, resolvedPath: this.resolveDeviceReadPath(agentId, targetPath) }
      : this.validatePath(agentId, targetPath, 'read', channel)
    if (!check.allowed) {
      throw new Error(check.reason)
    }

    if (!existsSync(check.resolvedPath)) {
      return {
        exists: false,
        isFile: false,
        isDirectory: false,
        size: 0,
        modifiedAt: null,
      }
    }

    const stat = statSync(check.resolvedPath)
    return {
      exists: true,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      size: stat.size,
      modifiedAt: stat.mtime,
    }
  }

  resolveDeviceReadPath(agentId: string, requestedPath?: string): string {
    const workspaceRoot = this.getWorkspaceRoot(agentId)
    return requestedPath
      ? path.isAbsolute(requestedPath)
        ? path.resolve(requestedPath)
        : path.resolve(workspaceRoot, requestedPath)
      : workspaceRoot
  }

  resolveTerminalCwd(agentId: string, requestedCwd: string | undefined, channel: string): string {
    const policy = getChannelFilePolicy(channel)
    const workspaceRoot = this.getWorkspaceRoot(agentId)

    // 策略为 workspace 时，强制使用 workspace root
    if (policy.terminalCwd === 'workspace') {
      return workspaceRoot
    }

    // 策略为 authorized 时，允许使用 requestedCwd（desktop 通道）
    if (requestedCwd) {
      // 验证 requestedCwd 是合法目录
      if (existsSync(requestedCwd) && statSync(requestedCwd).isDirectory()) {
        return requestedCwd
      }
      logger.warn(`请求的 cwd 不存在或不是目录，回退到 workspace: ${requestedCwd}`)
    }

    return workspaceRoot
  }
}

// ─────────────────────────────────────────────
// RPC 协议预留（第七阶段实现，第四阶段仅定义类型）
// ─────────────────────────────────────────────

/**
 * Workspace RPC 请求（第七阶段 Daemon 独立时使用）
 *
 * 第四阶段仅定义协议类型，不实现传输层。
 * 第七阶段实现 RemoteWorkspaceService 时通过 WebSocket 发送。
 */
export interface WorkspaceRpcRequest {
  op: 'read' | 'write' | 'list' | 'stat' | 'validate' | 'ensureWorkspace'
  agentId: string
  path?: string
  content?: string
  mode?: FileAccessMode
  channel?: string
  options?: ReadOptions | WriteOptions
}

/** Workspace RPC 响应 */
export interface WorkspaceRpcResponse {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Workspace RPC 协议处理器类型（第七阶段实现）
 *
 * 第七阶段的 RemoteWorkspaceService 会通过 WebSocket 发送 WorkspaceRpcRequest，
 * Daemon 端接收后调用 LocalWorkspaceService 处理，返回 WorkspaceRpcResponse。
 */
export type WorkspaceRpcHandler = (request: WorkspaceRpcRequest) => Promise<WorkspaceRpcResponse>

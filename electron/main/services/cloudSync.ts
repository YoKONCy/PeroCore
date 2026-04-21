/**
 * Steam Cloud Sync 服务
 *
 * - 所有 Steam API 调用通过 dynamic import
 * - standard 版构建时 tree-shaking 完全去除
 * - 同步策略: 先下载再上传 (last-write-wins)
 *
 * 数据目录结构 (相对于 paths.data):
 * - perocore.db          — 主数据库
 * - workspace/           — 日记、周报等
 * - memory/              — 记忆索引
 *
 * 排除项:
 * - .db-shm/.db-wal      — SQLite 运行时文件
 * - models_cache/         — 模型缓存 (太大)
 * - gateway_token.json    — 敏感信息
 * - tools/                — 第三方工具 (NapCat 等)
 *
 * @platform ELECTRON
 * @module electron/main/services/cloudSync
 */

import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../utils/env'
import { IS_STEAM } from './steam'
import { logger } from '../utils/logger'

// ── 同步配置 ──

const SYNC_CONFIG = {
  /** 需同步的单文件 (相对于 data/) */
  files: ['perocore.db', 'agent_launch_config.json'],
  /** 需递归同步的目录 (相对于 data/) */
  directories: ['workspace', 'memory'],
  /** 排除模式 */
  excludePatterns: [
    /\.db-shm$/, // SQLite 共享内存
    /\.db-wal$/, // SQLite 预写日志
    /\.tdb-shm$/, // TriviumDB 共享内存
    /\.tdb-wal$/, // TriviumDB 预写日志
    /gateway_token/, // 敏感信息
    /models_cache/, // 模型缓存
    /tools\//, // 第三方工具
    /sandbox/, // 沙盒临时文件
    /node_modules/, // 依赖目录
    /\.log$/, // 日志文件
  ],
  /** 文本文件扩展名 (其余视为二进制) */
  textExtensions: ['.json', '.md', '.txt', '.py', '.js', '.ts', '.yaml', '.yml'],
  /** 云端键名前缀 */
  cloudPrefix: 'perocore/',
}

// ── 类型 ──

export interface SyncResult {
  success: boolean
  uploaded: string[]
  downloaded: string[]
  failed: string[]
  errors: string[]
}

export interface CloudSyncStatus {
  /** 云同步是否可用 */
  enabled: boolean
  /** 是否为 Steam 版 */
  isSteam: boolean
  /** 上次同步时间 (epoch ms) */
  lastSyncTime: number | null
  /** 是否正在同步 */
  syncInProgress: boolean
}

// ── Cloud Sync Service ──

class CloudSyncService {
  private dataDir: string
  private lastSyncTime: number | null = null
  private syncInProgress = false

  /** steamworks.js 的 cloud API (延迟加载) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private steamCloud: any = null

  constructor() {
    this.dataDir = paths.data
  }

  // ─── 初始化 ───

  /**
   * 延迟加载 Steam Cloud API
   *
   * 仅在实际需要同步时调用，确保 standard 版零开销。
   */
  private ensureSteamCloud(): boolean {
    if (this.steamCloud) return true
    if (!IS_STEAM()) return false

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { cloud } = require('steamworks.js')
      this.steamCloud = cloud
      return true
    } catch {
      logger.warn('CloudSync', 'Steam Cloud API 不可用')
      return false
    }
  }

  // ─── 状态查询 ───

  getStatus(): CloudSyncStatus {
    return {
      enabled: IS_STEAM(),
      isSteam: IS_STEAM(),
      lastSyncTime: this.lastSyncTime,
      syncInProgress: this.syncInProgress,
    }
  }

  // ─── 文件扫描 ───

  /** 获取需要同步的所有文件 (相对路径) */
  private getSyncFiles(): string[] {
    const files: string[] = []

    // 1. 单文件
    for (const file of SYNC_CONFIG.files) {
      const absPath = path.join(this.dataDir, file)
      if (fs.existsSync(absPath) && !this.isExcluded(file)) {
        files.push(file)
      }
    }

    // 2. 递归目录
    for (const dir of SYNC_CONFIG.directories) {
      const absDir = path.join(this.dataDir, dir)
      if (fs.existsSync(absDir)) {
        this.scanDirectory(dir, files)
      }
    }

    return files
  }

  /** 递归扫描目录 */
  private scanDirectory(relativeDir: string, files: string[]): void {
    const absDir = path.join(this.dataDir, relativeDir)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name).replace(/\\/g, '/')

      if (entry.isDirectory()) {
        this.scanDirectory(relativePath, files)
      } else if (entry.isFile() && !this.isExcluded(relativePath)) {
        files.push(relativePath)
      }
    }
  }

  /** 检查文件是否被排除 */
  private isExcluded(relativePath: string): boolean {
    return SYNC_CONFIG.excludePatterns.some((p) => p.test(relativePath))
  }

  // ─── 文件读写 ───

  /** 将相对路径转换为云端键名 */
  private toCloudKey(relativePath: string): string {
    return SYNC_CONFIG.cloudPrefix + relativePath.replace(/\\/g, '/')
  }

  /** 判断是否为文本文件 */
  private isTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return SYNC_CONFIG.textExtensions.includes(ext)
  }

  /** 读取本地文件为字符串 (二进制文件 base64 编码) */
  private readLocalFile(relativePath: string): string | null {
    const absPath = path.join(this.dataDir, relativePath)
    try {
      if (this.isTextFile(relativePath)) {
        return fs.readFileSync(absPath, 'utf-8')
      } else {
        const buffer = fs.readFileSync(absPath)
        return 'base64:' + buffer.toString('base64')
      }
    } catch (e) {
      logger.error('CloudSync', `读取本地文件失败: ${relativePath} — ${e}`)
      return null
    }
  }

  /** 写入本地文件 (自动处理 base64 编码的二进制) */
  private writeLocalFile(relativePath: string, content: string): boolean {
    const absPath = path.join(this.dataDir, relativePath)
    try {
      // 确保目录存在
      fs.mkdirSync(path.dirname(absPath), { recursive: true })

      if (content.startsWith('base64:')) {
        const buffer = Buffer.from(content.slice(7), 'base64')
        fs.writeFileSync(absPath, buffer)
      } else {
        fs.writeFileSync(absPath, content, 'utf-8')
      }
      return true
    } catch (e) {
      logger.error('CloudSync', `写入本地文件失败: ${relativePath} — ${e}`)
      return false
    }
  }

  // ─── Steam Cloud 操作 ───

  /** 写入云端文件 */
  private writeCloudFile(key: string, content: string): boolean {
    if (!this.steamCloud) return false
    try {
      this.steamCloud.writeFile(key, Buffer.from(content, 'utf-8'))
      return true
    } catch (e) {
      logger.error('CloudSync', `写入云端失败: ${key} — ${e}`)
      return false
    }
  }

  /** 读取云端文件 */
  private readCloudFile(key: string): string | null {
    if (!this.steamCloud) return null
    try {
      const buffer = this.steamCloud.readFile(key)
      return buffer ? buffer.toString('utf-8') : null
    } catch {
      return null
    }
  }

  /** 列出云端所有文件 */
  private listCloudFiles(): Array<{ name: string; size: number }> {
    if (!this.steamCloud) return []
    try {
      const count: number = this.steamCloud.getFileCount()
      const files: Array<{ name: string; size: number }> = []
      for (let i = 0; i < count; i++) {
        const name: string = this.steamCloud.getFileNameAndSize(i)
        const size: number = this.steamCloud.getFileSize(name)
        files.push({ name, size })
      }
      return files
    } catch {
      return []
    }
  }

  /** 删除云端文件 */
  private deleteCloudFile(key: string): boolean {
    if (!this.steamCloud) return false
    try {
      this.steamCloud.deleteFile(key)
      return true
    } catch {
      return false
    }
  }

  // ─── 同步操作 ───

  /**
   * 上传所有本地数据到云端
   */
  async uploadToCloud(): Promise<SyncResult> {
    const result = this.initResult()
    if (!this.acquireLock(result)) return result
    if (!this.ensureSteamCloud()) {
      result.success = false
      result.errors.push('Steam Cloud API 不可用')
      this.syncInProgress = false
      return result
    }

    try {
      const files = this.getSyncFiles()
      logger.info('CloudSync', `开始上传 ${files.length} 个文件...`)

      for (const file of files) {
        const cloudKey = this.toCloudKey(file)
        const content = this.readLocalFile(file)

        if (content === null) {
          result.failed.push(file)
          result.errors.push(`无法读取: ${file}`)
          continue
        }

        if (this.writeCloudFile(cloudKey, content)) {
          result.uploaded.push(file)
        } else {
          result.failed.push(file)
          result.errors.push(`上传失败: ${file}`)
        }
      }

      // 写入同步元数据
      const metadata = {
        lastSyncTime: Date.now(),
        version: 2,
        fileCount: result.uploaded.length,
      }
      this.writeCloudFile(
        SYNC_CONFIG.cloudPrefix + 'sync_metadata.json',
        JSON.stringify(metadata, null, 2),
      )

      this.lastSyncTime = metadata.lastSyncTime
      result.success = result.failed.length === 0
      logger.info(
        'CloudSync',
        `上传完成: ${result.uploaded.length} 成功, ${result.failed.length} 失败`,
      )
    } catch (e) {
      result.success = false
      result.errors.push(`上传过程出错: ${e}`)
      logger.error('CloudSync', `上传过程出错: ${e}`)
    } finally {
      this.syncInProgress = false
    }

    return result
  }

  /**
   * 从云端下载所有数据到本地
   */
  async downloadFromCloud(): Promise<SyncResult> {
    const result = this.initResult()
    if (!this.acquireLock(result)) return result
    if (!this.ensureSteamCloud()) {
      result.success = false
      result.errors.push('Steam Cloud API 不可用')
      this.syncInProgress = false
      return result
    }

    try {
      // 读取同步元数据
      const metaStr = this.readCloudFile(SYNC_CONFIG.cloudPrefix + 'sync_metadata.json')
      if (metaStr) {
        const meta = JSON.parse(metaStr)
        logger.info(
          'CloudSync',
          `云端元数据: 上次同步 ${new Date(meta.lastSyncTime).toLocaleString()}`,
        )
      }

      // 获取云端文件列表
      const cloudFiles = this.listCloudFiles()
      const perocoreFiles = cloudFiles.filter((f) => f.name.startsWith(SYNC_CONFIG.cloudPrefix))
      logger.info('CloudSync', `开始下载 ${perocoreFiles.length} 个文件...`)

      for (const file of perocoreFiles) {
        // 跳过元数据
        if (file.name.endsWith('sync_metadata.json')) continue

        const relativePath = file.name.replace(SYNC_CONFIG.cloudPrefix, '')
        const content = this.readCloudFile(file.name)

        if (content === null) {
          result.failed.push(relativePath)
          result.errors.push(`无法下载: ${relativePath}`)
          continue
        }

        if (this.writeLocalFile(relativePath, content)) {
          result.downloaded.push(relativePath)
        } else {
          result.failed.push(relativePath)
          result.errors.push(`写入失败: ${relativePath}`)
        }
      }

      result.success = result.failed.length === 0
      this.lastSyncTime = Date.now()
      logger.info(
        'CloudSync',
        `下载完成: ${result.downloaded.length} 成功, ${result.failed.length} 失败`,
      )
    } catch (e) {
      result.success = false
      result.errors.push(`下载过程出错: ${e}`)
      logger.error('CloudSync', `下载过程出错: ${e}`)
    } finally {
      this.syncInProgress = false
    }

    return result
  }

  /**
   * 双向同步 (先下载再上传, last-write-wins)
   */
  async sync(): Promise<SyncResult> {
    logger.info('CloudSync', '开始双向同步...')

    const downloadResult = await this.downloadFromCloud()
    const uploadResult = await this.uploadToCloud()

    return {
      success: downloadResult.success && uploadResult.success,
      uploaded: uploadResult.uploaded,
      downloaded: downloadResult.downloaded,
      failed: [...downloadResult.failed, ...uploadResult.failed],
      errors: [...downloadResult.errors, ...uploadResult.errors],
    }
  }

  /**
   * 清除云端所有数据
   */
  async clearCloudData(): Promise<boolean> {
    if (!this.ensureSteamCloud()) return false

    try {
      const cloudFiles = this.listCloudFiles()
      const perocoreFiles = cloudFiles.filter((f) => f.name.startsWith(SYNC_CONFIG.cloudPrefix))

      for (const file of perocoreFiles) {
        this.deleteCloudFile(file.name)
      }

      logger.info('CloudSync', `已清除 ${perocoreFiles.length} 个云端文件`)
      return true
    } catch (e) {
      logger.error('CloudSync', `清除云端数据失败: ${e}`)
      return false
    }
  }

  // ─── 工具方法 ───

  private initResult(): SyncResult {
    return { success: true, uploaded: [], downloaded: [], failed: [], errors: [] }
  }

  private acquireLock(result: SyncResult): boolean {
    if (this.syncInProgress) {
      result.success = false
      result.errors.push('同步正在进行中')
      return false
    }
    this.syncInProgress = true
    return true
  }
}

// 导出单例
export const cloudSyncService = new CloudSyncService()

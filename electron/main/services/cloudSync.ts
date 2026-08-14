/**
 * Steam Cloud Sync 服务
 *
 * - 所有 Steam API 调用通过 dynamic import
 * - standard 版构建时 tree-shaking 完全去除
 * - 同步策略: 先下载再上传 (last-write-wins)
 *
 * 数据目录结构（相对于 paths.data）：
 * - infos.db                   — 主数据库（只通过一致性快照同步）
 * - agents/{id}/               — 用户 Agent 定义与覆盖
 * - principals/{id}/workspace/ — Agent 工作区
 * - agent_{id}/*.tdb              — Agent 向量记忆
 * - apps/ / attachments/          — 应用工作区与附件
 * - skills/ / extensions/         — 用户安装内容
 *
 * 排除项：
 * - SQLite/Trivium 运行时 WAL/SHM
 * - cache/models/logs 等可再生成内容
 * - gateway token 等敏感信息
 *
 * @platform ELECTRON
 * @module electron/main/services/cloudSync
 */

import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../utils/env'
import { IS_STEAM, getSteamCloudApi } from './steam'
import { logger } from '../utils/logger'

// ── 同步配置 ──

const SYNC_CONFIG = {
  /** 云端固定文件。数据库从 cloud-cache 中的一致性快照读取。 */
  files: ['infos.db', 'agent_launch_config.json'],
  /** 需递归同步的真实持久化目录 */
  directories: ['agents', 'principals', 'apps', 'attachments', 'skills', 'extensions', 'custom'],
  /** 数据目录中需额外匹配的动态目录（如 agent_pero/） */
  dynamicDirectoryPatterns: [/^agent_[^/\\]+$/],
  /**
   * 排除模式
   *
   * 同步策略说明（TriviumDB 0.7.x 实际磁盘布局，db = agent_{id}/{mode}.tdb）：
   * - 必须同步：*.tdb（元数据/图）、*.tdb.vec（Mmap 模式向量本体）、*.tdb.flush_ok（跨文件一致性标记）
   * - 保留同步：*.tdb.wal（WAL 崩溃恢复兜底；flush 后即清空，体积小）
   * - 保留同步：*.tdb.quiver（QuIVer ANN 索引；不匹配时加载端会自动删除重建，无害）
   * - 已排除：*.tdb.tmp / *.flush_ok.tmp / *.vec.tmp（写一半）、*.tdb.lock（文件锁）
   */
  excludePatterns: [
    /\.db-shm$/, // SQLite 共享内存
    /\.db-wal$/, // SQLite 预写日志
    /\.tmp$/, // 写一半的临时文件（TriviumDB: *.tdb.tmp / *.flush_ok.tmp / *.vec.tmp）
    /\.lock$/, // TriviumDB 文件锁（*.tdb.lock，防止多进程打开同一库，同步无意义）
    /gateway_token/, // 敏感信息
    /models_cache/, // 旧版模型缓存
    /(^|\/)models(\/|$)/, // 模型资源可从官方/Workshop/本地重新获取，避免占满云空间
    /(^|\/)cache(\/|$)/, // 可再生成缓存
    /(^|\/)cloud-cache(\/|$)/, // 数据库快照由专用映射上传
    /(^|\/)logs?(\/|$)/, // 日志目录
    /sandbox/, // 沙盒临时文件
    /node_modules/, // 依赖目录
    /\.log$/, // 日志文件
  ],
  /** 文本文件扩展名 (其余视为二进制) */
  textExtensions: ['.json', '.md', '.txt', '.py', '.js', '.ts', '.yaml', '.yml'],
  /** 云端键名前缀 */
  cloudPrefix: 'infos/',
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

  /** 获取已初始化 Steam Client 上的 Cloud API。 */
  private ensureSteamCloud(): boolean {
    if (this.steamCloud) return true
    if (!IS_STEAM()) return false

    this.steamCloud = getSteamCloudApi()
    if (!this.steamCloud) {
      logger.warn('CloudSync', 'Steam Cloud API 不可用')
      return false
    }
    return true
  }

  /** 请求后端通过 SQLite Backup API 生成一致性快照。 */
  private async createDatabaseSnapshot(): Promise<boolean> {
    try {
      const port = Number(process.env.PERO_PORT ?? 9120)
      const response = await fetch(`http://127.0.0.1:${port}/api/system/storage/sqlite-snapshot`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return fs.existsSync(path.join(this.dataDir, 'cloud-cache', 'infos.db'))
    } catch (e) {
      logger.error('CloudSync', `创建 SQLite 云存档快照失败: ${e}`)
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

    // 3. 动态目录（TriviumDB 按 agent_{id}/ 隔离）
    try {
      for (const entry of fs.readdirSync(this.dataDir, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          SYNC_CONFIG.dynamicDirectoryPatterns.some((pattern) => pattern.test(entry.name))
        ) {
          this.scanDirectory(entry.name, files)
        }
      }
    } catch {
      // 数据目录尚未创建时返回已收集文件即可。
    }

    return [...new Set(files)]
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

  /** 读取本地文件为字符串（二进制文件 base64 编码） */
  private readLocalFile(relativePath: string): string | null {
    // 主数据库上传必须读取后端生成的一致性快照，不能直接读取 WAL 模式下的活动文件。
    const localRelativePath =
      relativePath === 'infos.db' ? path.join('cloud-cache', 'infos.db') : relativePath
    const absPath = path.join(this.dataDir, localRelativePath)
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

  /** 将云端相对路径安全解析到本地数据目录，拒绝目录逃逸。 */
  private resolveLocalPath(relativePath: string): string | null {
    const root = path.resolve(this.dataDir)
    const target = path.resolve(root, relativePath)
    const relative = path.relative(root, target)
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : target
  }

  /** 写入本地文件（数据库写入 pending，其他文件直接恢复） */
  private writeLocalFile(relativePath: string, content: string): boolean {
    // 运行中的 Daemon 持有数据库连接，直接覆盖会损坏进程状态；下次启动前再原子恢复。
    const localRelativePath = relativePath === 'infos.db' ? 'infos.db.cloud-pending' : relativePath
    const absPath = this.resolveLocalPath(localRelativePath)
    if (!absPath) {
      logger.error('CloudSync', `拒绝越界云存档路径: ${relativePath}`)
      return false
    }
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
      return this.steamCloud.writeFile(key, content) === true
    } catch (e) {
      logger.error('CloudSync', `写入云端失败: ${key} — ${e}`)
      return false
    }
  }

  /** 读取云端文件 */
  private readCloudFile(key: string): string | null {
    if (!this.steamCloud) return null
    try {
      if (this.steamCloud.fileExists && !this.steamCloud.fileExists(key)) return null
      const content = this.steamCloud.readFile(key)
      return typeof content === 'string' ? content : null
    } catch {
      return null
    }
  }

  /** 列出云端所有文件（steamworks.js 0.4 使用 listFiles） */
  private listCloudFiles(): Array<{ name: string; size: number }> {
    if (!this.steamCloud) return []
    try {
      const files = this.steamCloud.listFiles() ?? []
      return files.map((file: { name: string; size: bigint | number }) => ({
        name: file.name,
        size: Number(file.size),
      }))
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
      if (!(await this.createDatabaseSnapshot())) {
        result.success = false
        result.errors.push('无法创建一致性数据库快照')
        return result
      }

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
      const infosFiles = cloudFiles.filter((f) => f.name.startsWith(SYNC_CONFIG.cloudPrefix))
      logger.info('CloudSync', `开始下载 ${infosFiles.length} 个文件...`)

      for (const file of infosFiles) {
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
   * 双向同步。
   *
   * 若下载包含数据库快照，恢复被延迟到下次 Daemon 启动；本轮禁止再上传旧数据库，
   * 避免刚下载的新云存档立即被当前进程中的旧库覆盖。其他普通文件仍可继续上传。
   */
  async sync(): Promise<SyncResult> {
    logger.info('CloudSync', '开始双向同步...')

    const downloadResult = await this.downloadFromCloud()
    if (downloadResult.downloaded.includes('infos.db')) {
      return {
        success: downloadResult.success,
        uploaded: [],
        downloaded: downloadResult.downloaded,
        failed: downloadResult.failed,
        errors: [
          ...downloadResult.errors,
          '数据库快照将在下次启动时恢复；为避免覆盖云端，本轮已跳过上传',
        ],
      }
    }

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
      const infosFiles = cloudFiles.filter((f) => f.name.startsWith(SYNC_CONFIG.cloudPrefix))

      for (const file of infosFiles) {
        this.deleteCloudFile(file.name)
      }

      logger.info('CloudSync', `已清除 ${infosFiles.length} 个云端文件`)
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

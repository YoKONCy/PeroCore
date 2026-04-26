/**
 * StickerService — 表情包映射服务
 *
 * 负责:
 * 1. 扫描 Agent 目录下 stickers/ 文件夹中的图片文件
 * 2. 构建 name → 绝对路径 的映射表
 * 3. 提供表情包列表字符串 (注入到 LLM prompt)
 * 4. 将 AI 回复拆分为 "文字 + 表情包" 的有序消息段
 *    → 发送端按顺序逐条发送，实现类似真人的表情包单独发送效果
 *
 * 目录结构:
 *   services/mdp/agents/{agentId}/stickers/
 *     开心.jpg
 *     难过.png
 *     ...
 *
 * AI 回复示例: "好的！[sticker:开心] 那我们走吧"
 * 拆分后: ["好的！", {sticker: "开心", path: "/.../开心.jpg"}, "那我们走吧"]
 *
 * @module packages/backend/src/services/social/stickerService
 */

import fs from 'node:fs'
import path from 'node:path'
import { createLogger } from '../../lib/logger'

const logger = createLogger('StickerService')

/** 支持的图片扩展名 */
const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

/** [sticker:name] 正则 (支持全角冒号、前后空格) */
const STICKER_TAG_RE = /\[\s*sticker\s*[:：]\s*(.*?)\s*\]/gi

// ─────────────────────────────────────────────
// 消息段类型
// ─────────────────────────────────────────────

/** 纯文字段 */
export interface TextSegment {
  type: 'text'
  content: string
}

/** 表情包段 */
export interface StickerSegment {
  type: 'sticker'
  name: string
  /** 表情包图片绝对路径 */
  filePath: string
}

/** 混合消息段 */
export type MessageSegment = TextSegment | StickerSegment

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class StickerService {
  /** Agent → (name → 绝对路径) 映射 */
  private agentStickerMaps = new Map<string, Map<string, string>>()
  /** MDP agents 根目录 */
  private agentsBaseDir: string

  constructor(agentsBaseDir: string) {
    this.agentsBaseDir = agentsBaseDir
  }

  /**
   * 加载指定 Agent 的表情包映射
   *
   * @returns 表情包名称列表 (逗号分隔，用于注入 prompt)
   */
  loadAgentStickers(agentId: string): string {
    if (!agentId) return ''

    // 缓存命中
    if (this.agentStickerMaps.has(agentId)) {
      const map = this.agentStickerMaps.get(agentId)!
      return [...map.keys()].join(', ')
    }

    try {
      const stickersDir = path.join(this.agentsBaseDir, agentId, 'stickers')

      if (!fs.existsSync(stickersDir)) {
        logger.debug(`Agent ${agentId} 无表情包目录: ${stickersDir}`)
        this.agentStickerMaps.set(agentId, new Map())
        return ''
      }

      const stickerMap = new Map<string, string>()
      const entries = fs.readdirSync(stickersDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isFile()) continue

        const rawExt = path.extname(entry.name)
        const ext = rawExt.toLowerCase()
        if (!SUPPORTED_EXTS.has(ext)) continue

        // 名称 = 不含扩展名的文件名
        const name = path.basename(entry.name, rawExt)
        const fullPath = path.join(stickersDir, entry.name)

        stickerMap.set(name, fullPath)
      }

      this.agentStickerMaps.set(agentId, stickerMap)

      if (stickerMap.size > 0) {
        logger.info(`Agent ${agentId} 已加载 ${stickerMap.size} 个表情包`)
      }

      return [...stickerMap.keys()].join(', ')
    } catch (err) {
      logger.warn(`加载 Agent ${agentId} 表情包失败: ${err}`)
      this.agentStickerMaps.set(agentId, new Map())
      return ''
    }
  }

  /**
   * 将 AI 回复拆分为有序消息段
   *
   * 输入: "好的！[sticker:开心] 那我们走吧 [sticker:挥手]"
   * 输出: [
   *   { type: 'text', content: '好的！' },
   *   { type: 'sticker', name: '开心', filePath: '/.../开心.jpg' },
   *   { type: 'text', content: ' 那我们走吧 ' },
   *   { type: 'sticker', name: '挥手', filePath: '/.../挥手.png' },
   * ]
   *
   * 不存在的表情包标签会被静默丢弃，不会发出去。
   */
  splitIntoSegments(content: string, agentId: string): MessageSegment[] {
    // 确保已加载
    if (!this.agentStickerMaps.has(agentId)) {
      this.loadAgentStickers(agentId)
    }

    const map = this.agentStickerMaps.get(agentId)
    if (!map || map.size === 0) {
      // 没有表情包 → 整段作为文字
      return content.trim() ? [{ type: 'text', content }] : []
    }

    const segments: MessageSegment[] = []
    let lastIndex = 0

    // 重置正则状态 (全局正则需要 reset)
    STICKER_TAG_RE.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = STICKER_TAG_RE.exec(content)) !== null) {
      const stickerName = match[1]!.trim()

      // 匹配前的文字段
      if (match.index > lastIndex) {
        const textBefore = content.slice(lastIndex, match.index).trim()
        if (textBefore) {
          segments.push({ type: 'text', content: textBefore })
        }
      }

      // 查找表情包文件
      const filepath = this.findSticker(map, stickerName)

      if (filepath) {
        segments.push({ type: 'sticker', name: stickerName, filePath: filepath })
      } else {
        // 未找到的表情包 → 静默丢弃，不发出去
        logger.warn(`表情包未找到已过滤: '${stickerName}' (Agent: ${agentId})`)
      }

      lastIndex = match.index + match[0].length
    }

    // 剩余文字
    if (lastIndex < content.length) {
      const remaining = content.slice(lastIndex).trim()
      if (remaining) {
        segments.push({ type: 'text', content: remaining })
      }
    }

    return segments
  }

  /** 查找表情包 (精确 + 不区分大小写) */
  private findSticker(map: Map<string, string>, name: string): string | undefined {
    // 精确匹配
    const filepath = map.get(name)
    if (filepath) return filepath

    // 不区分大小写
    for (const [key, val] of map) {
      if (key.toLowerCase() === name.toLowerCase()) {
        return val
      }
    }
    return undefined
  }

  /** 检查 Agent 是否有表情包 */
  hasStickers(agentId: string): boolean {
    if (!this.agentStickerMaps.has(agentId)) {
      this.loadAgentStickers(agentId)
    }
    const map = this.agentStickerMaps.get(agentId)
    return map !== undefined && map.size > 0
  }

  /** 清除指定 Agent 的缓存 (用于热更新) */
  clearCache(agentId?: string): void {
    if (agentId) {
      this.agentStickerMaps.delete(agentId)
    } else {
      this.agentStickerMaps.clear()
    }
  }
}

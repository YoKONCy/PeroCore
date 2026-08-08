/**
 * 标准 Bedrock JSON 模型提供者
 *
 * 负责加载普通的 .json Bedrock 模型文件、纹理和动画。
 * 优先尝试 Rust Native 模块进行高性能解析，
 * 失败时回退到纯 JavaScript 解析路径。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/StandardBedrockProvider
 */

import * as THREE from 'three'
import { logger } from '../../../../lib/logger'
import type { IModelProvider, ParsedModelData, ParsedBone } from './IModelProvider'
import type { IAvatarManifest } from './IAvatarManifest'
// Provider 接收到的路径已经是可直接 fetch 的 URL，无需额外转换

// ══════ 类型定义 ══════

/** 模型加载配置 */
interface ModelConfig {
  /** 模型名称 */
  name: string
  /** 模型文件路径 */
  model: string
  /** 纹理文件路径 */
  texture: string
  /** 动画文件路径列表 */
  animation?: string[]
}

/** Bedrock 几何体 JSON 中的骨骼定义 */
interface RawBedrockBone {
  name: string
  parent?: string
  pivot?: number[]
  rotation?: number[]
  cubes?: Record<string, unknown>[]
}

/** Electron 窗口扩展（render-core native API） */
interface ElectronWindow {
  electron?: {
    loadStandardModel?: (data: Uint8Array, filters?: string[]) => Promise<ParsedModelData>
  }
}

// ══════ Provider ══════

/**
 * 标准 Bedrock JSON 提供者
 *
 * 处理散文件夹形式的 Bedrock 模型（model.json + texture.png + animations/*.json）。
 */
export class StandardBedrockProvider implements IModelProvider {
  private config: ModelConfig
  private textureCache = new Map<string, THREE.Texture>()
  private boneFilterPatterns: string[] | undefined

  constructor(config: ModelConfig, boneFilterPatterns?: string[]) {
    this.config = config
    this.boneFilterPatterns = boneFilterPatterns
  }

  async getManifest(): Promise<Partial<IAvatarManifest>> {
    return {
      metadata: {
        name: this.config.name,
        version: '1.0.0',
      },
    }
  }

  async getModelData(): Promise<ParsedModelData> {
    // [调试开关] 设为 true 强制走 JS 路径（跳过 Rust），用于排查渲染问题
    const FORCE_JS_PATH = false

    const url = this.config.model
    const response = await fetch(url)
    if (!response.ok) throw new Error(`加载模型文件失败: ${this.config.model}`)
    const arrayBuffer = await response.arrayBuffer()

    // 优先尝试 Rust Native 模块解析（高性能路径）
    const electronWin = window as unknown as ElectronWindow
    if (!FORCE_JS_PATH && electronWin.electron?.loadStandardModel) {
      try {
        const parsedData = await electronWin.electron.loadStandardModel(
          new Uint8Array(arrayBuffer),
          this.boneFilterPatterns,
        )
        return parsedData
      } catch (e) {
        logger.warn('StandardBedrockProvider', 'Rust 解析失败，回退到 JS 路径', e)
      }
    }

    // JS 回退路径：直接解析 Bedrock JSON
    logger.info('StandardBedrockProvider', '使用 JS 路径解析模型')
    const jsonStr = new TextDecoder().decode(arrayBuffer)
    const json = JSON.parse(jsonStr)

    const geometry = json['minecraft:geometry']?.[0]
    if (!geometry) throw new Error('无效的 Bedrock 模型: 缺少 minecraft:geometry')

    const desc = geometry.description || {}
    const textureWidth = desc.texture_width || 64
    const textureHeight = desc.texture_height || 64

    const filterPatterns = this.boneFilterPatterns || []
    const rawBones = (geometry.bones || []) as RawBedrockBone[]

    const bones: ParsedBone[] = rawBones
      .filter((b) => {
        if (filterPatterns.length === 0) return true
        return !filterPatterns.some((pattern) =>
          b.name.toLowerCase().includes(pattern.toLowerCase()),
        )
      })
      .map((b) => ({
        name: b.name,
        parent: b.parent,
        pivot: (b.pivot || [0, 0, 0]) as [number, number, number],
        rotation: b.rotation as [number, number, number] | undefined,
        cubes: (b.cubes || []) as Record<string, unknown>[],
        // 注意：不提供 vertices/uvs/indices，让 AvatarRenderer 的 JS 回退路径处理
      }))

    return { textureWidth, textureHeight, bones }
  }

  async getTexture(): Promise<THREE.Texture> {
    const url = this.config.texture
    if (this.textureCache.has(url)) {
      return this.textureCache.get(url)!
    }

    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (t) => {
          t.magFilter = THREE.NearestFilter
          t.minFilter = THREE.NearestFilter
          t.colorSpace = THREE.SRGBColorSpace
          this.textureCache.set(url, t)
          resolve(t)
        },
        undefined,
        reject,
      )
    })
  }

  async getAnimations(): Promise<Map<string, unknown>> {
    const animations = new Map<string, unknown>()

    if (this.config.animation && Array.isArray(this.config.animation)) {
      for (const path of this.config.animation) {
        try {
          const url = path
          const res = await fetch(url)
          const json = await res.json()
          if (json.animations) {
            Object.entries(json.animations).forEach(([key, value]) => {
              animations.set(key, value)
            })
          }
        } catch (e) {
          logger.warn('StandardBedrockProvider', `加载动画失败: ${path}`, e)
        }
      }
    }

    return animations
  }
}

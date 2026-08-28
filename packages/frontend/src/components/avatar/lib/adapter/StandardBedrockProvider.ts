/**
 * 标准 Bedrock JSON 模型提供者
 *
 * 负责加载普通的 .json Bedrock 模型文件、纹理和动画。
 * 使用纯JavaScript解析Bedrock模型。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/StandardBedrockProvider
 */

import * as THREE from 'three'
import { logger } from '../../../../lib/logger'
import { YSM_SCENE_FILTERS } from '@infos/avatar-assets'
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

/**
 * 骨骼过滤：名称模式命中 + 场景摆件子树排除。
 *
 * 1. 名称过滤：移除"命中的骨骼本身"（如 GUI/Locator/molang 等辅助骨骼）。
 *    其子树会挂到根节点继续渲染——这是有意为之：武器本体挂在 Locator 挂点下
 *    （如星芒雨的发光刀、DeepSeek 的丝带），过滤挂点但不能连武器一起删。
 * 2. 场景摆件子树排除：仅对 YSM_SCENE_FILTERS（床/花/幽灵/猫等）额外整棵移除
 *    子树，避免床的满地花、猫的零件因"挂根复活"而残留。
 */
function filterBones(
  bones: ParsedBone[],
  patterns: string[],
  subtreePatterns: string[],
): ParsedBone[] {
  if (patterns.length === 0) return bones

  const matched = (name: string, list: string[]): boolean =>
    list.some((p) => name.toLowerCase().includes(p.toLowerCase()))

  // 1. 名称过滤：只移除命中的骨骼本身
  let result = bones.filter((b) => !matched(b.name, patterns))

  // 2. 场景摆件子树排除：父骨骼已被过滤且父名命中场景模式 → 整棵移除
  if (subtreePatterns.length > 0) {
    const boneSet = new Set(result.map((b) => b.name))
    const removed = new Set<string>()
    const queue: string[] = []

    for (const bone of result) {
      if (bone.parent && !boneSet.has(bone.parent) && matched(bone.parent, subtreePatterns)) {
        removed.add(bone.name)
        queue.push(bone.name)
      }
    }
    // BFS 收集全部后代，实现整棵子树排除
    while (queue.length > 0) {
      const parentName = queue.pop()!
      for (const bone of result) {
        if (bone.parent === parentName && !removed.has(bone.name)) {
          removed.add(bone.name)
          queue.push(bone.name)
        }
      }
    }
    if (removed.size > 0) {
      result = result.filter((b) => !removed.has(b.name))
    }
  }

  return result
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
    const url = this.config.model
    const response = await fetch(url)
    if (!response.ok) throw new Error(`加载模型文件失败: ${this.config.model}`)
    const arrayBuffer = await response.arrayBuffer()

    logger.info('StandardBedrockProvider', '使用JavaScript解析模型')
    const jsonStr = new TextDecoder().decode(arrayBuffer)
    const json = JSON.parse(jsonStr)

    const geometry = json['minecraft:geometry']?.[0]
    if (!geometry) throw new Error('无效的 Bedrock 模型: 缺少 minecraft:geometry')

    const desc = geometry.description || {}
    const textureWidth = desc.texture_width || 64
    const textureHeight = desc.texture_height || 64

    const rawBones = (geometry.bones || []) as RawBedrockBone[]

    const parsed: ParsedModelData = {
      textureWidth,
      textureHeight,
      bones: rawBones.map((b) => ({
        name: b.name,
        parent: b.parent,
        pivot: (b.pivot || [0, 0, 0]) as [number, number, number],
        rotation: b.rotation as [number, number, number] | undefined,
        cubes: (b.cubes || []) as Record<string, unknown>[],
      })),
    }

    // 统一应用骨骼过滤：名称模式命中 + 场景摆件子树排除。
    // 名称过滤移除辅助/摆件骨骼本身；YSM_SCENE_FILTERS 命中的场景摆件
    // 再整棵移除子树，避免床的满地花、猫的零件"挂根复活"渲染。
    const filterPatterns = this.boneFilterPatterns || []
    if (filterPatterns.length > 0) {
      parsed.bones = filterBones(parsed.bones, filterPatterns, YSM_SCENE_FILTERS)
    }

    return parsed
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

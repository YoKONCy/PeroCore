import * as THREE from 'three'

/**
 * Wiki 演示用的模型数据接口
 *
 * 从 frontend 的 IModelProvider 简化而来，
 * 避免 wiki 包直接依赖 @infos/frontend。
 */
export interface ParsedModelData {
  textureWidth: number
  textureHeight: number
  bones: Array<{
    name: string
    parent?: string
    pivot: number[]
    rotation?: number[]
    cubes?: unknown[]
  }>
}

export interface IModelProvider {
  getManifest(): Promise<unknown>
  getModelData(): Promise<ParsedModelData>
  getTexture(): Promise<THREE.Texture>
  getAnimations(): Promise<Map<string, unknown>>
}

/**
 * Wiki 演示专用的模型提供者
 *
 * 不依赖 Electron 环境，在浏览器中直接解析 Bedrock JSON。
 * 用于 Wiki 文档中的 3D 模型交互演示。
 */
export class WikiModelProvider implements IModelProvider {
  private config: any
  private textureCache = new Map<string, THREE.Texture>()
  private boneFilterPatterns: string[] | undefined

  constructor(config: any, boneFilterPatterns?: string[]) {
    this.config = config
    this.boneFilterPatterns = boneFilterPatterns
  }

  /** 获取模型元信息 */
  async getManifest(): Promise<unknown> {
    return {
      name: this.config.name,
      version: '1.0.0',
    }
  }

  /** 解析 Bedrock 模型数据 */
  async getModelData(): Promise<ParsedModelData> {
    const response = await fetch(this.config.model)
    if (!response.ok) throw new Error(`加载模型失败: ${this.config.model}`)
    const json = await response.json()

    let geo: any = null

    // 兼容新版 minecraft:geometry 格式 (数组)
    if (json['minecraft:geometry'] && Array.isArray(json['minecraft:geometry'])) {
      geo = json['minecraft:geometry'][0]
    } else {
      // 兼容旧版 geometry.xxx 格式
      const geometryName = Object.keys(json).find((k) => k.startsWith('geometry.'))
      if (geometryName) {
        geo = json[geometryName]
      }
    }

    if (!geo) throw new Error('无效的 Bedrock 模型文件：未找到 geometry 数据')

    const description = geo.description || {}

    // 转换为 ParsedModelData 结构
    let bones = geo.bones.map((bone: any) => ({
      name: bone.name,
      parent: bone.parent,
      pivot: bone.pivot || [0, 0, 0],
      rotation: bone.rotation,
      cubes: bone.cubes,
    }))

    // 骨骼过滤逻辑
    if (this.boneFilterPatterns && this.boneFilterPatterns.length > 0) {
      bones = bones.filter((bone: any) => {
        const boneNameLower = bone.name.toLowerCase()
        return !this.boneFilterPatterns!.some((pattern) =>
          boneNameLower.includes(pattern.toLowerCase()),
        )
      })
    }

    return {
      textureWidth: description.texture_width || geo.texturewidth || 64,
      textureHeight: description.texture_height || geo.textureheight || 64,
      bones,
    }
  }

  /** 加载模型贴图 */
  async getTexture(): Promise<THREE.Texture> {
    if (this.textureCache.has(this.config.texture)) {
      return this.textureCache.get(this.config.texture)!
    }

    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        this.config.texture,
        (t) => {
          t.magFilter = THREE.NearestFilter
          t.minFilter = THREE.NearestFilter
          t.colorSpace = THREE.SRGBColorSpace
          this.textureCache.set(this.config.texture, t)
          resolve(t)
        },
        undefined,
        reject,
      )
    })
  }

  /** 加载动画数据 */
  async getAnimations(): Promise<Map<string, unknown>> {
    const animations = new Map<string, unknown>()

    if (this.config.animation && Array.isArray(this.config.animation)) {
      for (const animPath of this.config.animation) {
        try {
          const res = await fetch(animPath)
          const json = await res.json()
          if (json.animations) {
            Object.entries(json.animations).forEach(([key, value]) => {
              animations.set(key, value)
            })
          }
        } catch (e) {
          console.warn(`加载动画失败: ${animPath}`, e)
        }
      }
    }

    return animations
  }
}

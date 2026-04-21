/**
 * 动画库
 *
 * 存储和管理已加载的动画数据。支持从 Bedrock 格式 JSON
 * 解析动画轨道（旋转/位移/缩放），并提供按名称检索功能。
 *
 * @module packages/frontend/src/components/avatar/lib/animation/AnimationLibrary
 */

import type { IAnimationData, IBoneTrack, IKeyframe } from './AnimationTypes'

// ══════ Bedrock 动画 JSON 的原始类型 ══════

/** Bedrock 关键帧值 — 可能是向量、Molang 表达式或嵌套对象 */
type RawKeyframeValue =
  | [number, number, number]
  | string
  | number
  | { post?: [number, number, number]; lerp_mode?: 'linear' | 'catmullrom' }

/** Bedrock 动画轨道 — 可能是直接值、向量或时间映射对象 */
type RawTrackData = string | number | [number, number, number] | Record<string, RawKeyframeValue>

/** Bedrock 骨骼轨道 */
interface RawBoneTracks {
  rotation?: RawTrackData
  position?: RawTrackData
  scale?: RawTrackData
}

/** Bedrock 动画原始数据 */
interface RawAnimationData {
  loop?: boolean
  animation_length?: number
  bones?: Record<string, RawBoneTracks>
}

/**
 * 动画库
 *
 * 管理所有已加载的动画数据。
 * 支持从 raw Bedrock JSON 解析，也接受已解析的 IAnimationData。
 */
export class AnimationLibrary {
  private animations: Map<string, IAnimationData> = new Map()

  /**
   * 添加动画数据
   *
   * 自动检测传入的数据格式：
   * - 如果已有 `name` 字段 → 视为已解析的 IAnimationData
   * - 否则 → 视为原始 Bedrock JSON，执行解析
   *
   * @param name - 动画名称
   * @param data - 原始 Bedrock 数据或已解析的 IAnimationData
   */
  add(name: string, data: RawAnimationData | IAnimationData): void {
    if (data && typeof data === 'object' && !('name' in data)) {
      // 原始 Bedrock 动画数据，需要解析
      this.animations.set(name, this.parseAnimation(name, data as RawAnimationData))
    } else {
      this.animations.set(name, data as IAnimationData)
    }
  }

  /**
   * 获取动画数据
   *
   * @param name - 动画名称
   * @returns 动画数据，不存在时返回 undefined
   */
  get(name: string): IAnimationData | undefined {
    return this.animations.get(name)
  }

  /**
   * 移除动画数据
   *
   * @param name - 动画名称
   */
  remove(name: string): void {
    this.animations.delete(name)
  }

  /** 获取所有已注册的动画名称 */
  getNames(): string[] {
    return Array.from(this.animations.keys())
  }

  /** 清空整个动画库 */
  clear(): void {
    this.animations.clear()
  }

  /**
   * 从 URL 加载 Bedrock 格式动画文件
   *
   * @param url - 动画 JSON 文件 URL
   */
  async loadFromUrl(url: string): Promise<void> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`[AnimationLibrary] 加载动画失败: ${url}`)
        return
      }
      const json = await response.json()
      const anims = json.animations as Record<string, RawAnimationData> | undefined
      if (anims) {
        for (const [name, data] of Object.entries(anims)) {
          this.add(name, data)
        }
      }
    } catch (e) {
      console.error(`[AnimationLibrary] 加载动画出错 (${url}):`, e)
    }
  }

  // ══════ 内部方法 ══════

  /** 将原始 Bedrock 动画数据解析为标准 IAnimationData */
  private parseAnimation(name: string, data: RawAnimationData): IAnimationData {
    const parsedBones: Record<string, IBoneTrack> = {}

    if (data.bones) {
      for (const [boneName, tracks] of Object.entries(data.bones)) {
        const boneTrack: IBoneTrack = {}
        if (tracks.rotation) boneTrack.rotation = this.parseTrack(tracks.rotation)
        if (tracks.position) boneTrack.position = this.parseTrack(tracks.position)
        if (tracks.scale) boneTrack.scale = this.parseTrack(tracks.scale)
        parsedBones[boneName] = boneTrack
      }
    }

    return {
      name,
      loop: data.loop !== false,
      length: data.animation_length || 0,
      bones: parsedBones,
    }
  }

  /**
   * 解析单个动画轨道数据
   *
   * Bedrock 轨道数据可能是：
   * - 标量/字符串（Molang）→ 单关键帧
   * - 向量 [x,y,z] → 单关键帧
   * - 时间映射对象 { "0.0": [...], "1.0": [...] } → 多关键帧
   */
  private parseTrack(trackData: RawTrackData): IKeyframe[] {
    // 标量或 Molang 字符串 → 填充到 [val, val, val]
    if (typeof trackData === 'string' || typeof trackData === 'number') {
      const val = trackData as unknown as number
      return [{ time: 0, value: [val, val, val] }]
    }

    // 向量 [x, y, z] → 单关键帧
    if (Array.isArray(trackData)) {
      return [{ time: 0, value: trackData as [number, number, number] }]
    }

    // 时间映射对象 → 多关键帧
    if (typeof trackData === 'object') {
      const keyframes: IKeyframe[] = []
      for (const [timeStr, value] of Object.entries(trackData)) {
        let vec = value
        let lerpMode: 'linear' | 'catmullrom' = 'linear'

        // 嵌套对象格式: { post: [...], lerp_mode: "catmullrom" }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const nested = value as {
            post?: [number, number, number]
            lerp_mode?: 'linear' | 'catmullrom'
          }
          if (nested.post) vec = nested.post
          if (nested.lerp_mode) lerpMode = nested.lerp_mode
        }

        if (Array.isArray(vec)) {
          keyframes.push({
            time: parseFloat(timeStr),
            value: vec as [number, number, number],
            lerpMode,
          })
        }
      }
      keyframes.sort((a, b) => a.time - b.time)
      return keyframes
    }

    return []
  }
}

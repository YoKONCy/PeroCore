/**
 * 动画数据类型定义
 *
 * 描述 Bedrock 格式动画的标准数据结构，
 * 包含骨骼轨道、关键帧和插值模式。
 *
 * @module packages/frontend/src/components/avatar/lib/animation/AnimationTypes
 */

/** 动画数据 — 描述一段标准动画的完整结构 */
export interface IAnimationData {
  /** 动画名称标识符 */
  name: string
  /** 是否循环播放 */
  loop: boolean
  /** 动画总时长（秒） */
  length: number
  /** 骨骼轨道映射（Key = 骨骼名称） */
  bones: Record<string, IBoneTrack>
}

/** 骨骼轨道 — 包含旋转/位移/缩放的关键帧序列 */
export interface IBoneTrack {
  /** 旋转关键帧序列 */
  rotation?: IKeyframe[]
  /** 位移关键帧序列 */
  position?: IKeyframe[]
  /** 缩放关键帧序列 */
  scale?: IKeyframe[]
}

/** 关键帧 — 时间点上的变换值 */
export interface IKeyframe {
  /** 时间点（秒） */
  time: number
  /** 变换值 [x, y, z] 或单个标量 */
  value: [number, number, number] | number
  /** 插值模式（默认 linear） */
  lerpMode?: 'linear' | 'catmullrom'
}

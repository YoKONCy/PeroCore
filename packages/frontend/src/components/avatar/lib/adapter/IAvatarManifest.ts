/**
 * 头像清单接口定义
 *
 * 定义模型的所有配置元数据，包括部件控制、重定向映射、
 * 资源路径等。未来将随模型打包进 .pero 容器。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/IAvatarManifest
 */

import type { IRetargetingMap } from '../retargeting/RetargetingConfig'

/** 功能按钮定义 — 用于 UI 动态生成控制按钮 */
export interface FeatureButton {
  /** 功能唯一标识符（在状态对象中查找对应布尔值） */
  id: string
  /** 显示名称（支持多语言） */
  label: string
  /** 按钮图标（可选） */
  icon?: string
  /** 所属分组（可选，用于 UI 分类） */
  group?: string
  /** 默认状态 */
  defaultValue?: boolean
}

/** 部件定义 — 声明模型中可控制的部件 */
export interface PartDefinition {
  /** 部件唯一标识符 */
  id: string
  /** 对应的网格名称列表 */
  meshes: string[]
  /** 是否默认可见 */
  defaultVisible?: boolean
}

/** 模型元数据 */
export interface AvatarMetadata {
  /** 模型名称 */
  name: string
  /** 模型版本 */
  version?: string
  /** 作者信息 */
  author?: string
  /** 模型描述 */
  description?: string
  /** 缩略图路径（可选） */
  thumbnail?: string
}

/** 害羞部件配置 — 定义在特定状态下触发的部件行为 */
export interface ShyPartConfig {
  /** 网格名匹配模式 */
  meshPattern: string
  /** Z 轴偏移量 */
  zOffset?: number
  /** Z 轴阈值 */
  zThreshold?: number
}

/**
 * 头像清单接口
 *
 * 定义模型的所有配置信息，包括元数据、功能按钮、
 * 部件定义、重定向映射和资源路径。
 */
export interface IAvatarManifest {
  /** 模型元数据 */
  metadata: AvatarMetadata
  /** 功能按钮列表 */
  featureButtons: FeatureButton[]
  /** 可控制部件列表 */
  parts?: PartDefinition[]
  /** 骨骼重定向映射配置 */
  retargetingMap: IRetargetingMap

  /** 资源文件路径 */
  resources: {
    /** 模型文件路径（.json 或 .pero） */
    model: string
    /** 纹理文件路径 */
    texture: string
    /** 动画文件路径列表 */
    animations?: string[]
  }

  /** 骨骼过滤模式（glob 匹配，用于移除 GUI/辅助骨骼） */
  boneFilterPatterns?: string[]
  /** 害羞部件配置 */
  shyParts?: ShyPartConfig[]
  /** 害羞触发部件名列表 */
  shyTriggerParts?: string[]
  /** 动画控制器路径 */
  animation_controllers?: string | string[]
}

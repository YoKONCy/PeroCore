/**
 * 模型适配器接口
 *
 * 封装不同模型的特定逻辑（骨骼过滤、部件可见性控制、
 * 重定向配置等），使 AvatarRenderer 可以透明地支持多种模型。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/IModelAdapter
 */

import type * as THREE from 'three'
import type { IRetargetingMap } from '../retargeting/RetargetingConfig'
import type { FeatureButton, PartDefinition, IAvatarManifest } from './IAvatarManifest'
import type { ParsedBone } from './IModelProvider'

/**
 * 模型适配器接口
 *
 * 每个模型（或模型家族）应提供一个适配器实现，
 * 封装该模型的骨骼命名规则、部件组织方式等特有逻辑。
 */
export interface IModelAdapter {
  /** 适配器名称 */
  name: string

  /**
   * 判断是否适用于该模型路径
   * @param modelPath - 模型文件路径
   */
  canHandle(modelPath: string): boolean

  /**
   * 过滤骨骼数据
   *
   * 在模型加载前调用，用于移除不需要的骨骼（如 GUI、辅助骨骼）。
   *
   * @param bones - 原始骨骼数据数组
   * @returns 过滤后的骨骼数据数组
   */
  filterBones(bones: ParsedBone[]): ParsedBone[]

  /**
   * 应用服装/部件状态
   *
   * @param scene - 模型根节点
   * @param state - 服装状态对象（Key = 部件 ID, Value = 是否显示）
   */
  applyClothingState(scene: THREE.Object3D, state: Record<string, boolean>): void

  /**
   * 获取重定向配置
   *
   * 提供特定模型的骨骼名称 → 标准骨骼名称的映射关系。
   */
  getRetargetingConfig(): IRetargetingMap

  /** 获取功能按钮列表（用于 UI 动态生成控制面板） */
  getFeatureButtons?(): FeatureButton[]

  /** 获取部件定义列表 */
  getParts?(): PartDefinition[]

  /** 获取完整的清单配置 */
  getManifest?(): Partial<IAvatarManifest>
}

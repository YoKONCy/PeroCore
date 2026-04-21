/**
 * 基于 Manifest 的通用模型适配器
 *
 * 从 IAvatarManifest 动态生成适配器行为，
 * 消除硬编码，实现模型配置的完全外部化。
 * 所有部件可见性控制、骨骼过滤、害羞表情等行为
 * 均通过 Manifest JSON 配置驱动。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/ManifestBasedAdapter
 */

import type * as THREE from 'three'
import type { IModelAdapter } from './IModelAdapter'
import type { IAvatarManifest, FeatureButton, PartDefinition } from './IAvatarManifest'
import type { IRetargetingMap } from '../retargeting/RetargetingConfig'
import type { ParsedBone } from './IModelProvider'

// ══════ 默认骨骼过滤模式（用于移除 GUI/辅助骨骼） ══════

const DEFAULT_BONE_FILTER_PATTERNS = [
  'GUI',
  'Hud',
  'Panel',
  'Button',
  'Text',
  'Start',
  'End',
  'background',
  'molang',
]

/**
 * 基于 Manifest 的通用模型适配器
 *
 * 完全由配置文件驱动，不包含任何模型特定的硬编码逻辑。
 */
export class ManifestBasedAdapter implements IModelAdapter {
  /** 适配器名称（取自 Manifest 元数据） */
  name: string
  private manifest: IAvatarManifest

  constructor(manifest: IAvatarManifest) {
    this.manifest = manifest
    this.name = manifest.metadata.name
  }

  /** 获取原始 Manifest */
  getManifest(): IAvatarManifest {
    return this.manifest
  }

  /**
   * 判断是否适用于该模型路径
   *
   * 基于模型名称进行模糊匹配。
   */
  canHandle(modelPath: string): boolean {
    const modelName = this.manifest.metadata.name.toLowerCase()
    return modelPath.toLowerCase().includes(modelName)
  }

  /**
   * 过滤骨骼数据
   *
   * 从 Manifest 的 `boneFilterPatterns` 中读取过滤规则，
   * 移除 GUI、辅助骨骼等不需要渲染的骨骼。
   */
  filterBones(bones: ParsedBone[]): ParsedBone[] {
    const filterPatterns = this.manifest.boneFilterPatterns || DEFAULT_BONE_FILTER_PATTERNS

    return bones.filter((b) => {
      const name = b.name
      if (name === 'Start' || name === 'End') return false
      if (filterPatterns.some((pattern) => name.includes(pattern))) return false
      return true
    })
  }

  /**
   * 应用服装/部件状态
   *
   * 基于 Manifest 中的 `parts` 和 `shyParts` 定义动态控制部件可见性。
   *
   * @param scene - 模型根节点
   * @param state - 部件状态对象 (Key = 部件 ID, Value = 是否显示)
   */
  applyClothingState(scene: THREE.Object3D, state: Record<string, boolean>): void {
    const parts = this.manifest.parts || []
    const shyParts = this.manifest.shyParts || []
    const isShy = this.calculateShyState(state)

    scene.traverse((child) => {
      const name = child.name
      if (!name) return

      let handled = false

      // 部件可见性控制
      for (const part of parts) {
        if (part.meshes.some((meshName) => name.includes(meshName) || name === meshName)) {
          child.visible = state[part.id] ?? part.defaultVisible ?? true
          handled = true
          break
        }
      }

      // 害羞部件控制
      if (!handled && shyParts.length > 0) {
        for (const shyPart of shyParts) {
          if (name.includes(shyPart.meshPattern)) {
            child.visible = isShy
            if (shyPart.zOffset && child.position.z > (shyPart.zThreshold ?? 0)) {
              child.position.z += shyPart.zOffset
            }
          }
        }
      }
    })
  }

  /** 获取重定向配置 */
  getRetargetingConfig(): IRetargetingMap {
    return this.manifest.retargetingMap
  }

  /** 获取功能按钮列表 */
  getFeatureButtons(): FeatureButton[] {
    return this.manifest.featureButtons || []
  }

  /** 获取部件定义列表 */
  getParts(): PartDefinition[] {
    return this.manifest.parts || []
  }

  /** 获取资源路径配置 */
  getResources(): IAvatarManifest['resources'] {
    return this.manifest.resources
  }

  // ══════ 内部方法 ══════

  /**
   * 计算害羞状态
   *
   * 当 `shyTriggerParts` 中的任一部件被关闭时触发害羞。
   */
  private calculateShyState(state: Record<string, boolean>): boolean {
    const triggers = this.manifest.shyTriggerParts || []
    return triggers.some((partId) => state[partId] === false)
  }
}

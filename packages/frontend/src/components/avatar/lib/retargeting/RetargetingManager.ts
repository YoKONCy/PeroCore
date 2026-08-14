/**
 * 骨骼重定向管理器
 *
 * 运行时将标准动画数据映射到特定模型的骨骼上。
 * 支持精确匹配、模糊匹配和别名查找三种骨骼定位策略，
 * 并缓存初始变换以支持每帧重置和增量叠加。
 *
 * @module packages/frontend/src/components/avatar/lib/retargeting/RetargetingManager
 */

import * as THREE from 'three'
import type { IRetargetingMap } from './RetargetingConfig'
import { StandardBones } from './RetargetingConfig'

// ══════ 类型定义 ══════

/** 骨骼的初始变换快照 */
interface InitialTransform {
  /** 初始位置 */
  pos: THREE.Vector3
  /** 初始旋转（四元数） */
  rot: THREE.Quaternion
  /** 初始旋转（欧拉角，保留旋转顺序） */
  euler: THREE.Euler
  /** 初始缩放 */
  scale: THREE.Vector3
}

// ══════ 骨骼别名 ══════

/** 预定义的标准骨骼别名映射（用于模糊匹配不同模型的命名规则） */
const BONE_ALIASES: Record<string, string[]> = {
  [StandardBones.Head]: ['AllHead', 'head', 'HeadBone'],
  [StandardBones.Body]: ['UpperBody', 'Torso', 'AllBody', 'body', 'BodyBone'],
  [StandardBones.Root]: ['root', 'RootBone', 'Origin'],
  [StandardBones.LeftArm]: ['LeftArm', 'ArmL', 'arm_left', 'Left_Arm'],
  [StandardBones.RightArm]: ['RightArm', 'ArmR', 'arm_right', 'Right_Arm'],
  [StandardBones.LeftLeg]: ['LeftLeg', 'LegL', 'leg_left', 'Left_Leg'],
  [StandardBones.RightLeg]: ['RightLeg', 'LegR', 'leg_right', 'Right_Leg'],
  [StandardBones.Mouth]: ['Mouth', 'mouth', 'Jaw', 'jaw'],
  [StandardBones.EyeBrow]: ['EyeBrow', 'eyebrow', 'Eyebrow', 'Brow'],
  [StandardBones.LeftEye]: ['LeftEye', 'EyeL', 'eye_left'],
  [StandardBones.RightEye]: ['RightEye', 'EyeR', 'eye_right'],
}

/** 标准化骨骼名称（去除下划线/连字符/空格后转小写） */
function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '')
}

// ══════ 管理器 ══════

/**
 * 骨骼重定向管理器
 *
 * 核心职责：
 * 1. 建立标准骨骼名称 → 模型实际骨骼对象的映射
 * 2. 缓存所有骨骼的初始变换（用于每帧重置）
 * 3. 提供旋转/位移/缩放的应用接口（含姿态修正）
 */
export class RetargetingManager {
  /** 标准名称 → Three.js 骨骼对象 */
  private boneMap: Map<string, THREE.Object3D> = new Map()
  /** 骨骼名称 → 初始变换快照 */
  private initialTransforms: Map<string, InitialTransform> = new Map()
  /** 重定向配置 */
  private config: IRetargetingMap | null = null
  /** 模型根节点 */
  private modelRoot: THREE.Object3D | null = null
  /** 缓存所有骨骼名称（用于模糊匹配） */
  private allBoneNames: string[] = []
  /** 适配器注册的自定义别名 */
  private customAliases: Map<string, string[]> = new Map()

  /**
   * 注册自定义骨骼别名
   *
   * 允许适配器为特定模型注册额外的别名映射规则。
   *
   * @param standardName - 标准骨骼名称
   * @param aliases - 该标准骨骼在特定模型中可能的名称列表
   */
  registerAliases(standardName: string, aliases: string[]): void {
    this.customAliases.set(standardName, aliases)
  }

  /**
   * 初始化骨骼映射
   *
   * 遍历模型骨骼树，建立标准名称到实际骨骼的映射，
   * 并缓存所有骨骼的初始变换。
   *
   * @param modelRoot - 模型根节点
   * @param config - 重定向配置
   */
  init(modelRoot: THREE.Object3D, config: IRetargetingMap): void {
    this.config = config
    this.modelRoot = modelRoot
    this.boneMap.clear()
    this.initialTransforms.clear()
    this.allBoneNames = []

    // 预缓存所有骨骼名称
    modelRoot.traverse((obj) => {
      if (obj.name) {
        this.allBoneNames.push(obj.name)
      }
    })

    // 1. 从配置映射中加载
    for (const [standardName, targetName] of Object.entries(config.mapping)) {
      this.findAndCacheBone(modelRoot, standardName, targetName)
    }

    // 2. 自动回退机制 — 对配置中未定义的标准骨骼尝试多种查找方式
    for (const key of Object.keys(StandardBones)) {
      const standardName = StandardBones[key as keyof typeof StandardBones]
      if (this.boneMap.has(standardName)) continue

      // a. 直接查找标准名称
      if (this.findAndCacheBone(modelRoot, standardName, standardName)) continue

      // b. 预定义别名
      const aliases = BONE_ALIASES[standardName] || []
      let found = false
      for (const alias of aliases) {
        if (this.findAndCacheBone(modelRoot, standardName, alias)) {
          found = true
          break
        }
      }
      if (found) continue

      // c. 自定义别名（适配器注册）
      const custom = this.customAliases.get(standardName) || []
      for (const alias of custom) {
        if (this.findAndCacheBone(modelRoot, standardName, alias)) {
          found = true
          break
        }
      }
      if (found) continue

      // d. 模糊查找
      const fuzzyBone = this.fuzzyFindBone(standardName)
      if (fuzzyBone) {
        this.boneMap.set(standardName, fuzzyBone)
        this.cacheInitialTransform(standardName, fuzzyBone)
      }
    }

    // 3. 预缓存所有模型骨骼的初始变换
    // 确保动态查找的骨骼（如耳朵、尾巴）在动画修改前就有正确的初始状态
    modelRoot.traverse((obj) => {
      if (obj.name && !this.initialTransforms.has(obj.name)) {
        this.initialTransforms.set(obj.name, {
          pos: obj.position.clone(),
          rot: obj.quaternion.clone(),
          euler: obj.rotation.clone(),
          scale: obj.scale.clone(),
        })
      }
    })
  }

  /**
   * 获取标准骨骼对应的实际 Three.js 对象
   *
   * 先查缓存，缓存未命中则尝试精确/模糊查找。
   *
   * @param standardName - 标准骨骼名称或模型原始骨骼名称
   * @returns 骨骼对象，不存在时返回 undefined
   */
  getBone(standardName: string): THREE.Object3D | undefined {
    const cached = this.boneMap.get(standardName)
    if (cached) return cached

    if (this.modelRoot) {
      // 精确查找
      let bone = this.modelRoot.getObjectByName(standardName)

      // 模糊查找
      if (!bone) {
        bone = this.fuzzyFindBone(standardName) ?? undefined
      }

      if (bone) {
        this.boneMap.set(standardName, bone)
        if (!this.initialTransforms.has(standardName)) {
          this.cacheInitialTransform(standardName, bone)
        }
        return bone
      }
    }

    return undefined
  }

  /** 获取所有已映射的骨骼名称 */
  getMappedBoneNames(): string[] {
    return Array.from(this.boneMap.keys())
  }

  /** 检查骨骼是否已映射 */
  hasBone(standardName: string): boolean {
    return this.boneMap.has(standardName) || !!this.fuzzyFindBone(standardName)
  }

  /**
   * 获取骨骼的初始旋转（四元数）
   *
   * @param standardName - 标准骨骼名称
   * @returns 初始四元数（不存在时返回单位四元数）
   */
  getInitialRotation(standardName: string): THREE.Quaternion {
    const init = this.initialTransforms.get(standardName)
    return init ? init.rot.clone() : new THREE.Quaternion()
  }

  /**
   * 获取骨骼的初始旋转（欧拉角）
   *
   * 直接返回缓存的欧拉角，避免四元数→欧拉角转换带来的角度歧义。
   *
   * @param standardName - 标准骨骼名称
   * @returns 初始欧拉角（不存在时返回 ZXY 零欧拉角）
   */
  getInitialEuler(standardName: string): THREE.Euler {
    const init = this.initialTransforms.get(standardName)
    return init ? init.euler.clone() : new THREE.Euler(0, 0, 0, 'ZXY')
  }

  /**
   * 应用旋转到标准骨骼
   *
   * @param standardName - 标准骨骼名称
   * @param rotation - 欧拉角或四元数
   */
  applyRotation(standardName: string, rotation: THREE.Euler | THREE.Quaternion): void {
    const bone = this.getBone(standardName)
    if (!bone) return

    if (rotation instanceof THREE.Euler) {
      bone.rotation.copy(rotation)
    } else {
      bone.quaternion.copy(rotation)
    }

    // 应用姿态修正（如 T-Pose → A-Pose 的旋转校正）
    const restPoseCorrection = this.config?.restPoseCorrection
    if (restPoseCorrection?.[standardName]) {
      const correction = restPoseCorrection[standardName]
      bone.rotation.x += correction[0]
      bone.rotation.y += correction[1]
      bone.rotation.z += correction[2]
    }
  }

  /**
   * 应用位置到标准骨骼
   *
   * @param standardName - 标准骨骼名称
   * @param position - 位置向量或元组
   */
  applyPosition(standardName: string, position: THREE.Vector3 | [number, number, number]): void {
    const bone = this.getBone(standardName)
    if (!bone) return

    if (Array.isArray(position)) {
      bone.position.set(position[0], position[1], position[2])
    } else {
      bone.position.copy(position)
    }
  }

  /**
   * 应用缩放到标准骨骼
   *
   * @param standardName - 标准骨骼名称
   * @param scale - 缩放向量或元组
   */
  applyScale(standardName: string, scale: THREE.Vector3 | [number, number, number]): void {
    const bone = this.getBone(standardName)
    if (!bone) return

    if (Array.isArray(scale)) {
      bone.scale.set(scale[0], scale[1], scale[2])
    } else {
      bone.scale.copy(scale)
    }
  }

  /**
   * 重置所有骨骼到初始状态
   *
   * 每帧调用以确保动画使用干净的基准姿态，
   * 防止程序化动画（头部追踪等）的旋转累加。
   */
  reset(): void {
    this.initialTransforms.forEach((init, name) => {
      // 优先从 boneMap 获取，其次从模型直接查找
      let bone = this.boneMap.get(name)
      if (!bone && this.modelRoot) {
        bone = this.modelRoot.getObjectByName(name)
      }
      if (bone) {
        bone.position.copy(init.pos)
        // 使用欧拉角重置，保持骨骼构建时设定的原始旋转顺序（如 ZYX）
        bone.rotation.copy(init.euler)
        bone.scale.copy(init.scale)
      }
    })
  }

  // ══════ 内部方法 ══════

  /**
   * 模糊查找骨骼
   *
   * 通过标准化名称（去除分隔符后比较）进行相似度匹配。
   * 不使用过于宽松的"包含匹配"以避免误匹配。
   */
  private fuzzyFindBone(targetName: string): THREE.Object3D | null {
    if (!this.modelRoot) return null

    // 精确匹配
    const exact = this.modelRoot.getObjectByName(targetName)
    if (exact) return exact

    // 标准化后模糊匹配
    const normalizedTarget = normalizeBoneName(targetName)
    for (const boneName of this.allBoneNames) {
      if (normalizeBoneName(boneName) === normalizedTarget) {
        const bone = this.modelRoot.getObjectByName(boneName)
        if (bone) return bone
      }
    }

    return null
  }

  /** 缓存骨骼的初始变换快照 */
  private cacheInitialTransform(name: string, bone: THREE.Object3D): void {
    this.initialTransforms.set(name, {
      pos: bone.position.clone(),
      rot: bone.quaternion.clone(),
      euler: bone.rotation.clone(),
      scale: bone.scale.clone(),
    })
  }

  /**
   * 查找并缓存骨骼
   *
   * @returns 是否成功找到并缓存
   */
  private findAndCacheBone(
    modelRoot: THREE.Object3D,
    standardName: string,
    targetName: string,
  ): boolean {
    const bone = modelRoot.getObjectByName(targetName)
    if (bone) {
      this.boneMap.set(standardName, bone)
      this.initialTransforms.set(standardName, {
        pos: bone.position.clone(),
        rot: bone.quaternion.clone(),
        euler: bone.rotation.clone(),
        scale: bone.scale.clone(),
      })
      return true
    }
    return false
  }
}

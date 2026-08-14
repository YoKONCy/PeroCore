/**
 * Avatar 模型加载 Composable
 *
 * 负责根据 Manifest 选择正确的 Provider（Standard/Secure/Container），
 * 构建 3D 模型、初始化适配器和重定向管理器、加载动画。
 *
 * @module packages/frontend/src/composables/avatar/useAvatarModel
 */

import { ref, watch } from 'vue'
import { logger } from '../../lib/logger'
import * as THREE from 'three'
import type { IModelAdapter } from '../../components/avatar/lib/adapter/IModelAdapter'
import type { IModelProvider } from '../../components/avatar/lib/adapter/IModelProvider'
import type {
  IAvatarManifest,
  FeatureButton,
} from '../../components/avatar/lib/adapter/IAvatarManifest'
import { AvatarRenderer } from '../../components/avatar/lib/AvatarRenderer'
import { StandardBedrockProvider } from '../../components/avatar/lib/adapter/StandardBedrockProvider'
import { PeroContainerProvider } from '../../components/avatar/lib/adapter/PeroContainerProvider'
import { ManifestBasedAdapter } from '../../components/avatar/lib/adapter/ManifestBasedAdapter'
import { ManifestLoader } from '../../components/avatar/lib/adapter/ManifestLoader'
import { RetargetingManager } from '../../components/avatar/lib/retargeting/RetargetingManager'
import { AnimationLibrary } from '../../components/avatar/lib/animation/AnimationLibrary'
import type {
  IAnimationData,
  IKeyframe,
} from '../../components/avatar/lib/animation/AnimationTypes'
import { AnimationEngine } from '../../components/avatar/lib/animation/AnimationEngine'
import { AnimationControllerSystem } from '../../components/avatar/lib/animation/AnimationController'
import { StandardBones } from '../../components/avatar/lib/retargeting/RetargetingConfig'
import { YsmMolangRunner } from '../../components/avatar/lib/ysm/YsmMolangRunner'
import { molang, molangContext } from '../../components/avatar/lib/Molang'
import { loadYsmManifestFromUrl } from '../../components/avatar/lib/ysm/loadYsmManifest'
import { YSM_SCENE_FILTERS } from '@infos/shared/ysm'
import {
  DEFAULT_AVATAR_MANIFEST_PATH,
  DEFAULT_AVATAR_YSM_PATH,
} from '../../components/avatar/lib/avatarDefaults'

/** 模型加载结果 */
export interface AvatarModelState {
  /** 加载中 */
  loading: boolean
  /** 错误消息 */
  errorMsg: string
  /** 动画名称列表 */
  animList: string[]
}

/** 内部模型配置（从 Manifest 生成） */
interface ModelConfig {
  name: string
  model: string
  texture: string
  animation: string[]
  animation_controllers?: string | string[]
}

/**
 * 基准体型（height_scale=0.7）的目标总包围盒高度。
 *
 * 以手写 manifest 的 Rossi 模型为视觉基准：Rossi 不参与归一化（source 为空），
 * 保持原始几何尺寸，其 bind pose 包围盒高度约 59.5、脚底线 y=-5，
 * 在桌宠窗口里顶天立地、视觉正确。
 * 每个 YSM 模型再乘以自身 height_scale/0.7 的体型系数，保留作者设计的娇小差异。
 *
 * 基准高度从 52 下调到 47（约 -10%）：统一让所有 YSM 模型再小一档，
 * 避免与 Rossi 并排时压迫感过强；Rossi 本身不参与归一化，视觉不变。
 */
const BASE_MODEL_HEIGHT = 47

/** 基准体型的目标主体高度（与总高同步下调，保持主体占比兜底逻辑一致） */
const BASE_BODY_HEIGHT = 34

/**
 * 归一化后总包围盒高度上限：装饰占大头的模型（星芒雨/酒狐）经主体兜底放大后
 * 总高可能完全冲出视野，必须封顶避免"巨大到超出屏幕"。
 */
const MAX_TOTAL_HEIGHT = 62

/**
 * 横向（宽/深）最大尺寸基准。
 *
 * 仅按高度归一化的宽体模型（大裙摆、大翅膀、深尾巴等）在屏上仍显大，
 * 通过总包围盒横向 max(size.x, size.z) 再收敛一次，让默认缩放适合更多模型。
 * 普通体型的 MC 角色横向约 16~20，30 已是 1.5 倍宽松阈值，不会误伤正常模型。
 */
const BASE_MODEL_WIDTH = 30

/** 主体占比低于该阈值时判定"包围盒被高装饰稀释"，改用主体高度兜底归一化 */
const MIN_BODY_RATIO = 0.6

/** YSM 模型脚底线（地面站位），与 Rossi 的包围盒最低点一致 */
const TARGET_YSM_FLOOR_Y = -5

/**
 * 估算角色主体高度：取包含 90% 体积的最窄 y 区间。
 *
 * 部分 YSM 模型包围盒被高发髻/飘带等装饰撑大，若直接按总包围盒归一化，
 * 角色本体会被压小。主体高度用于识别这类"装饰稀释"并兜底。
 */
function estimateBodyHeight(rootGroup: THREE.Object3D): number {
  // 收集每个 Mesh 的世界 y 区间与体积
  const segments: Array<{ y0: number; y1: number; vol: number }> = []
  let totalVol = 0

  rootGroup.updateMatrixWorld(true)
  rootGroup.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const box = new THREE.Box3().setFromObject(mesh)
    const boxSize = new THREE.Vector3()
    box.getSize(boxSize)
    const vol = boxSize.x * boxSize.y * boxSize.z
    if (!Number.isFinite(vol) || vol <= 0) return
    segments.push({ y0: box.min.y, y1: box.max.y, vol })
    totalVol += vol
  })

  if (totalVol <= 0 || segments.length === 0) return 0

  // 滑动窗口找包含 90% 体积的最窄 y 区间
  const targetVol = totalVol * 0.9
  const ys = Array.from(new Set(segments.flatMap((s) => [s.y0, s.y1]))).sort((a, b) => a - b)
  let bestSpan = Infinity
  let left = 0

  for (let right = 0; right < ys.length; right++) {
    const lo = ys[left]!
    const hi = ys[right]!
    let volIn = 0
    for (const seg of segments) if (seg.y0 >= lo && seg.y1 <= hi) volIn += seg.vol

    // 收缩左边界，保持窗口内体积仍达标
    while (left < right) {
      const lo2 = ys[left + 1]!
      let volIn2 = 0
      for (const seg of segments) if (seg.y0 >= lo2 && seg.y1 <= hi) volIn2 += seg.vol
      if (volIn2 >= targetVol) {
        left++
        volIn = volIn2
      } else break
    }

    if (volIn >= targetVol) {
      const span = hi - lo
      if (span < bestSpan) bestSpan = span
    }
  }

  return Number.isFinite(bestSpan) ? bestSpan : 0
}

/**
 * 合并 YSM 通用场景摆件过滤模式到 manifest 的 boneFilterPatterns（去重）。
 *
 * 特莉波卡等模型的落盘 manifest 可能是旧版生成的、未包含最新摆件模式，
 * 前端加载时强制合并，保证通用机制始终生效。
 * 同时移除历史上误加的 'band' 模式：DeepSeek 的 EyeBand（眼罩）与
 * Band*（发带/裙带）都是可见装饰骨骼，'band' 子串匹配会把它们整批过滤掉。
 */
function mergeSceneFilters(patterns?: string[]): string[] {
  const merged = patterns ? patterns.filter((p) => p.toLowerCase() !== 'band') : []
  for (const pattern of YSM_SCENE_FILTERS) {
    if (!merged.some((p) => p.toLowerCase() === pattern.toLowerCase())) {
      merged.push(pattern)
    }
  }
  return merged
}

/**
 * 容器模式脚本路径还原
 *
 * 容器内文件没有独立 URL，ysmFunctions 声明的是容器内相对路径（如 functions/x.molang）。
 * Electron 扫描 manifest 时路径会被重写为 asset://model/{key}/functions/x.molang，
 * 这里还原为容器内相对路径，以便从解密后的内存容器读取。
 */
function toContainerRelativePath(path: string): string {
  if (path.startsWith('asset://')) {
    try {
      const segments = new URL(path).pathname.split('/').filter(Boolean)
      segments.shift() // 去掉模型键
      const relative = segments.join('/')
      if (relative) return decodeURIComponent(relative)
    } catch {
      /* 解析失败时按原路径处理 */
    }
  }
  return path
}

/**
 * 几何启发式：移除离角色主体过远的场景组件骨骼子树。
 *
 * 命名过滤只能覆盖已知命名的摆件；对于作者用随意命名做的"远处场景件"
 * （如特莉波卡 z=-37 的发光装饰），通过"骨骼子树包围盒中心到主体质心的
 * 水平距离"判断并整棵移除，作为命名过滤的通用兜底。
 *
 * 注意只比较水平距离（忽略 y）：角色高发髻/翅膀等装饰虽高但水平贴近主体，
 * 不能被误删；真正的场景摆件往往水平方向远离角色。
 *
 * @returns 移除的骨骼子树数量
 */
function removeDistantSceneryBones(rootGroup: THREE.Object3D): number {
  rootGroup.updateMatrixWorld(true)

  // 1. 收集所有 Mesh 的世界包围盒中心与体积
  const centers: THREE.Vector3[] = []
  const vols: number[] = []
  rootGroup.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const box = new THREE.Box3().setFromObject(mesh)
    const size = new THREE.Vector3()
    box.getSize(size)
    const vol = size.x * size.y * size.z
    if (!Number.isFinite(vol) || vol <= 0) return
    centers.push(box.getCenter(new THREE.Vector3()))
    vols.push(vol)
  })
  if (centers.length === 0) return 0

  // 2. 体积加权质心 ≈ 角色主体中心
  const totalVol = vols.reduce((a, b) => a + b, 0)
  const centroid = new THREE.Vector3()
  centers.forEach((center, index) => {
    centroid.addScaledVector(center, vols[index]! / totalVol)
  })

  // 3. 水平距离（忽略 y）中位数反映"主体横向半径"；
  //    阈值取中位数的 4 倍且下限 50，保守兜底避免误删高发髻/翅膀等装饰。
  const dists = centers.map((c) => Math.hypot(c.x - centroid.x, c.z - centroid.z))
  const sorted = [...dists].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  const threshold = Math.max(median * 4, 50)

  // 4. 递归判断骨骼子树：子树中心水平距离过远 → 整棵从场景移除
  let removedCount = 0
  const examineSubtree = (obj: THREE.Object3D): void => {
    let subBox: THREE.Box3 | null = null
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      const b = new THREE.Box3().setFromObject(mesh)
      subBox = subBox ? subBox.union(b) : b
    })
    const subtreeBounds = subBox as THREE.Box3 | null
    if (!subtreeBounds) return

    const center = subtreeBounds.getCenter(new THREE.Vector3())
    const hDist = Math.hypot(center.x - centroid.x, center.z - centroid.z)
    if (hDist > threshold) {
      obj.removeFromParent()
      removedCount++
      return
    }
    // 中心在主体附近，继续下钻检查子骨骼
    for (const child of [...obj.children]) {
      examineSubtree(child)
    }
  }

  for (const child of [...rootGroup.children]) {
    examineSubtree(child)
  }
  return removedCount
}

/**
 * 按渲染后实际几何包围盒归一化 YSM 模型，并保留作者体型差异。
 *
 * visible_bounds_height 只是 Minecraft 的剔除范围，作者经常填写远大于真实模型的值，
 * 不能用于视觉尺寸。必须等待模型完成构建与骨骼过滤后，再读取 Three.js Box3。
 *
 * @param bodyScaleFactor - YSM height_scale/0.7 体型系数（越大越显高，娇小模型 < 1）
 */
function normalizeYsmModelScale(rootGroup: THREE.Object3D, bodyScaleFactor = 1): void {
  rootGroup.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(rootGroup)
  const size = new THREE.Vector3()
  bounds.getSize(size)

  if (!Number.isFinite(size.y) || size.y <= 0) {
    logger.warn('AvatarModel', '无法计算 YSM 模型实际高度，保持原始尺寸')
    return
  }

  const totalH = size.y
  const bodyH = estimateBodyHeight(rootGroup)

  // 基础目标：总包围盒高度对齐基准（乘以体型系数保留娇小差异）
  const targetTotal = BASE_MODEL_HEIGHT * bodyScaleFactor
  let scale = targetTotal / totalH

  // 主体占比过低 → 包围盒被高装饰稀释，改用主体高度兜底，
  // 保证角色本体不小于基准主体 × 体型系数（防止本体被压小）。
  if (bodyH > 0 && bodyH / totalH < MIN_BODY_RATIO) {
    const targetBody = BASE_BODY_HEIGHT * bodyScaleFactor
    scale = Math.max(scale, targetBody / bodyH)
  }

  // 总高上限：主体兜底放大后，星芒雨/酒狐这类"本体小+装饰巨高"的模型
  // 总高可能完全冲出视野，封顶限制避免"巨大到超出屏幕"。
  scale = Math.min(scale, MAX_TOTAL_HEIGHT / totalH)

  // 横向收敛：大裙摆/翅膀/深尾巴等宽体模型仅按高度归一化后仍显大，
  // 用总包围盒横向最大尺寸（宽或深）再压一档，让默认缩放适配更多模型。
  const maxHorizontal = Math.max(size.x, size.z)
  if (Number.isFinite(maxHorizontal) && maxHorizontal > 0) {
    scale = Math.min(scale, BASE_MODEL_WIDTH / maxHorizontal)
  }

  rootGroup.scale.multiplyScalar(scale)
  rootGroup.updateMatrixWorld(true)

  // 缩放后把脚底对齐到统一地面线（Rossi 的站位 y=-5），
  // 避免部分模型包围盒含大片地下部分时"陷入地面"或"悬空"。
  const scaledBounds = new THREE.Box3().setFromObject(rootGroup)
  rootGroup.position.y += TARGET_YSM_FLOOR_Y - scaledBounds.min.y
  rootGroup.updateMatrixWorld(true)

  logger.info(
    'AvatarModel',
    `YSM 尺度归一化: 总高 ${totalH.toFixed(2)}，主体 ${bodyH.toFixed(2)}，` +
      `体型系数 ${bodyScaleFactor.toFixed(2)}，最终缩放 ${scale.toFixed(3)}，脚底对齐 y=${TARGET_YSM_FLOOR_Y}`,
  )
}

export function useAvatarModel() {
  // ═══ 响应式状态 ═══
  const loading = ref(true)
  const errorMsg = ref('')
  const animList = ref<string[]>([])
  const featureButtons = ref<FeatureButton[]>([])
  const clothingState = ref<Record<string, boolean>>({})

  // ═══ 非响应式实例 ═══
  const retargetingManager = new RetargetingManager()
  const animationLibrary = new AnimationLibrary()
  const animationEngine = new AnimationEngine(retargetingManager)
  const controllerSystem = new AnimationControllerSystem(animationEngine, animationLibrary)

  let characterModel: THREE.Object3D | null = null
  let currentAdapter: IModelAdapter | null = null
  let currentProvider: IModelProvider | undefined
  let lastLoadedConfig: ModelConfig | null = null
  /** YSM molang 运行时（functions/*.molang 控制器脚本） */
  let ysmRunner: YsmMolangRunner | null = null
  /**
   * YSM checkbox 与骨骼显隐的绑定。
   *
   * Rossi 通过 manifest.parts 直接设置 Object3D.visible，行为稳定；YSM 则通常在
   * parallel* 动画的 scale 表达式里声明绑定。加载时解析这些声明，点击按钮时也直接
   * 设置 visible，避免并行动画未播放、混合权重或 Molang 时序导致开关失效。
   */
  let ysmVisibilityBindings: Array<{ boneName: string; expression: string }> = []
  /** 嘴巴骨骼（用于口型同步） */
  let mouthBone: THREE.Object3D | null = null
  /** 眉毛骨骼初始 Y 位置 */
  let initialEyebrowY = 0

  // ═══ 服装部件状态持久化（按模型路径区分，客户端 localStorage） ═══

  const AVATAR_CLOTHING_STORAGE_PREFIX = 'ppc.avatar_clothing.'

  /** 读取指定模型的服装部件偏好 */
  function readClothingPrefs(modelKey: string): Record<string, boolean> | null {
    try {
      const raw = localStorage.getItem(AVATAR_CLOTHING_STORAGE_PREFIX + modelKey)
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : null
    } catch {
      return null
    }
  }

  /** 保存当前模型的服装部件偏好 */
  function saveClothingPrefs(): void {
    const modelKey = lastLoadedConfig?.model
    if (!modelKey) return
    try {
      localStorage.setItem(
        AVATAR_CLOTHING_STORAGE_PREFIX + modelKey,
        JSON.stringify(clothingState.value),
      )
    } catch {
      // 忽略存储失败（如隐私模式下禁用 localStorage）
    }
  }

  // 部件开关变化即持久化，重启客户端后自动恢复
  watch(clothingState, saveClothingPrefs, { deep: true })

  // ═══ 部件状态管理 ═══

  /** 根据适配器的功能按钮初始化部件状态（优先恢复客户端持久化的偏好） */
  function initFeatureState(buttons: FeatureButton[], modelKey?: string): void {
    const state: Record<string, boolean> = {}
    const saved = modelKey ? readClothingPrefs(modelKey) : null
    buttons.forEach((btn) => {
      const persisted = saved && typeof saved[btn.id] === 'boolean' ? saved[btn.id] : null
      state[btn.id] = persisted ?? btn.defaultValue ?? true
    })
    clothingState.value = state
    featureButtons.value = buttons
  }

  /** 从关键帧中提取单值 Molang 表达式。 */
  function getTrackExpression(keyframes?: IKeyframe[]): string | null {
    if (!keyframes?.length) return null
    const value = keyframes[0]?.value
    if (typeof value === 'string') return value
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
    return null
  }

  /**
   * 从 YSM parallel* 动画的 scale 通道自动识别 checkbox → 骨骼映射。
   * 仅收集引用当前 featureButtons 变量的表达式，避免把普通缩放动画误当成显隐开关。
   */
  function collectYsmVisibilityBindings(animations: Map<string, unknown>): void {
    ysmVisibilityBindings = []
    const buttonIds = featureButtons.value.map((button) => button.id)
    if (buttonIds.length === 0) return

    for (const [name, rawAnimation] of animations) {
      if (!/^parallel\d*$/.test(name)) continue
      const animation = rawAnimation as IAnimationData
      for (const [boneName, tracks] of Object.entries(animation.bones || {})) {
        const expression = getTrackExpression(tracks.scale)
        if (!expression || !buttonIds.some((id) => expression.includes(id))) continue
        ysmVisibilityBindings.push({ boneName, expression })
      }
    }
  }

  /**
   * 使用 Rossi 同款的 Object3D.visible 机制应用 YSM checkbox。
   * 表达式在当前 Molang 变量上下文中求值：结果大于 0 即显示，支持
   * `v.xxx` 与 `1 - v.xxx` 两种正向/反向绑定（例如普通眼睛与发光眼睛互斥）。
   */
  function applyYsmVisibilityState(): void {
    if (!characterModel || ysmVisibilityBindings.length === 0) return
    for (const binding of ysmVisibilityBindings) {
      const bone = characterModel.getObjectByName(binding.boneName)
      if (bone) bone.visible = molang.eval(binding.expression) > 0.0001
    }
  }

  /** 更新部件可见性（Rossi parts + YSM checkbox） */
  function updateClothing(): void {
    if (!characterModel || !currentAdapter) return
    currentAdapter.applyClothingState(characterModel, clothingState.value)

    // 先同步 checkbox 状态到统一 Molang 上下文；即使模型没有 functions/*.molang，
    // parallel 动画表达式与直接显隐逻辑也能读取到最新值。
    for (const btn of featureButtons.value) {
      const key = btn.id.replace(/^(v|variable)\./, '')
      molangContext.variable[key] = clothingState.value[btn.id] ? 1 : 0
      ysmRunner?.setVariable(btn.id, clothingState.value[btn.id] ? 1 : 0)
    }
    applyYsmVisibilityState()

    // 应用即持久化：保证任何入口（外观菜单开关/加载后应用）都会把最新配置落盘，
    // 不依赖 watch 的单一触发时机。
    saveClothingPrefs()
  }

  // ═══ Provider 选择逻辑 ═══

  /** 根据格式自动选择 Provider */
  function createProvider(config: ModelConfig, manifest: IAvatarManifest): IModelProvider {
    const boneFilterPatterns = manifest.boneFilterPatterns

    // 模型是 .pero → 容器加密加载器。
    // 贴图既可以在容器内（texture 也指向 .pero），也可以放外边明文（texture 指向 .png URL），
    // PeroContainerProvider 会优先使用外部明文贴图。
    if (config.model.endsWith('.pero')) {
      logger.info('AvatarModel', `使用容器加载器: ${manifest.metadata.name}`)
      return new PeroContainerProvider(config.model, config.texture, boneFilterPatterns)
    }

    return new StandardBedrockProvider(config, boneFilterPatterns)
  }

  // ═══ 控制器加载 ═══

  async function loadControllers(config: ModelConfig, provider?: IModelProvider): Promise<void> {
    controllerSystem.reset()

    // 1. 从 Provider 加载控制器
    if (provider && 'getAnimationControllers' in provider) {
      try {
        const providerWithCtrl = provider as IModelProvider & {
          getAnimationControllers(): Promise<Map<string, unknown>>
        }
        const controllers = await providerWithCtrl.getAnimationControllers()
        if (controllers.size > 0) {
          logger.info('AvatarModel', `从 Provider 加载了 ${controllers.size} 个动画控制器`)
          controllerSystem.loadFromJson({
            format_version: '1.10.0',
            animation_controllers: Object.fromEntries(controllers),
          } as Parameters<typeof controllerSystem.loadFromJson>[0])
        }
      } catch (e) {
        logger.warn('AvatarModel', '从 Provider 加载控制器失败', e)
      }
    }

    // 2. 传统路径加载
    if (config.animation_controllers) {
      const paths = Array.isArray(config.animation_controllers)
        ? config.animation_controllers
        : [config.animation_controllers]
      for (const path of paths) {
        await controllerSystem.load(path)
      }
    }
  }

  // ═══ 核心加载逻辑 ═══

  /**
   * 加载模型到场景
   *
   * @param manifest - 模型 Manifest
   * @param scene - Three.js Scene
   */
  async function loadAvatar(manifest: IAvatarManifest, scene: THREE.Scene): Promise<void> {
    try {
      // YSM 模型强制合并通用场景摆件过滤模式：不依赖落盘 manifest 是否已用
      // 最新模式重新生成，保证"纯人物"通用机制对任何 YSM 模型始终生效。
      if (manifest.source === 'ysm') {
        manifest = {
          ...manifest,
          boneFilterPatterns: mergeSceneFilters(manifest.boneFilterPatterns),
        }
      }

      const resources = manifest.resources
      const config: ModelConfig = {
        name: manifest.metadata.name,
        model: resources.model,
        texture: resources.texture,
        animation: resources.animations || [],
        animation_controllers: (manifest as unknown as Record<string, unknown>)
          .animation_controllers as string | string[] | undefined,
      }

      const provider = createProvider(config, manifest)
      currentProvider = provider

      // 容器格式：合并容器内 manifest
      let effectiveManifest = manifest
      // model 是 .pero 即视为容器加密格式（贴图可能容器内、也可能外部明文）
      const isContainerFormat = config.model.endsWith('.pero')

      if (isContainerFormat) {
        try {
          const containerManifest = await provider.getManifest()
          if (containerManifest && (containerManifest as Record<string, unknown>).featureButtons) {
            const cm = containerManifest as Record<string, unknown>
            effectiveManifest = {
              ...manifest,
              ...(cm as Partial<IAvatarManifest>),
              metadata: {
                ...manifest.metadata,
                ...((cm.metadata as Record<string, unknown>) || {}),
              } as IAvatarManifest['metadata'],
              resources: {
                ...manifest.resources,
                ...((cm.resources as Record<string, unknown>) || {}),
              } as IAvatarManifest['resources'],
              retargetingMap:
                (cm.retargetingMap as IAvatarManifest['retargetingMap']) || manifest.retargetingMap,
              featureButtons: (cm.featureButtons as FeatureButton[]) || [],
              parts: (cm.parts as IAvatarManifest['parts']) || [],
              boneFilterPatterns:
                (cm.boneFilterPatterns as string[]) || manifest.boneFilterPatterns,
            }
            logger.info(
              'AvatarModel',
              `容器 manifest 加载成功，${effectiveManifest.featureButtons?.length || 0} 个功能按钮`,
            )
          }
        } catch (e) {
          logger.warn('AvatarModel', '从容器加载 manifest 失败，使用默认配置', e)
        }
      }

      // 构建 3D 模型
      const avatarRenderer = new AvatarRenderer()
      const rootGroup = await avatarRenderer.build(provider)

      // 几何启发式：移除离角色主体过远的场景组件（命名过滤的通用兜底）
      if (effectiveManifest.source === 'ysm') {
        const removedCount = removeDistantSceneryBones(rootGroup)
        if (removedCount > 0) {
          logger.info('AvatarModel', `几何启发式移除 ${removedCount} 个远处场景组件`)
        }
      }

      // 尺度归一化：YSM 的 visible_bounds_height 是剔除范围而非真实几何高度，
      // 因此必须按构建后的 Three.js 包围盒计算；非 YSM 手写 manifest 仍可显式指定 scale。
      // manifest.scale 即 height_scale/0.7 体型系数，用于保留作者设计的娇小体型差异。
      if (effectiveManifest.source === 'ysm') {
        normalizeYsmModelScale(rootGroup, effectiveManifest.scale || 1)
      } else if (effectiveManifest.scale && effectiveManifest.scale > 0) {
        rootGroup.scale.set(
          effectiveManifest.scale,
          effectiveManifest.scale,
          effectiveManifest.scale,
        )
      }

      // 移除旧模型
      if (characterModel) {
        scene.remove(characterModel)
        characterModel = null
      }

      characterModel = rootGroup

      // 适配器初始化
      currentAdapter = new ManifestBasedAdapter(effectiveManifest)
      const retargetConfig = currentAdapter.getRetargetingConfig()
      retargetingManager.init(rootGroup, retargetConfig)

      if (currentAdapter.getFeatureButtons) {
        initFeatureState(currentAdapter.getFeatureButtons(), config.model)
      }

      // 缓存关键骨骼
      mouthBone = retargetingManager.getBone(StandardBones.Mouth) || null
      const eyeBrow = retargetingManager.getBone(StandardBones.EyeBrow)
      if (eyeBrow) {
        initialEyebrowY = eyeBrow.position.y
      }

      scene.add(rootGroup)

      // 加载动画
      animationLibrary.clear()
      const animations = await provider.getAnimations()
      animations.forEach((clip: unknown, name: string) => {
        animationLibrary.add(name, clip as Parameters<typeof animationLibrary.add>[1])
      })
      // featureButtons 已初始化，此时可从 YSM 并行动画中建立 Rossi 同款直接显隐绑定。
      if (effectiveManifest.source === 'ysm') {
        const parsedAnimations = new Map<string, unknown>()
        for (const name of animationLibrary.getNames()) {
          parsedAnimations.set(name, animationLibrary.get(name))
        }
        collectYsmVisibilityBindings(parsedAnimations)
        logger.info('AvatarModel', `已识别 ${ysmVisibilityBindings.length} 个 YSM 部件显隐绑定`)
      } else {
        ysmVisibilityBindings = []
      }

      lastLoadedConfig = config
      await loadControllers(config)

      // YSM molang 运行时：加载 functions/*.molang 控制器脚本
      // （DeepSeek 等 YSM 模型的眨眼/倒走/碰墙抬手等行为依赖此运行时）
      ysmRunner = null
      const ysmFunctions = (manifest as unknown as { ysmFunctions?: string[] }).ysmFunctions
      // 容器模式：脚本文件在解密后的内存容器内，从 provider 读取而非 fetch URL
      const containerProvider =
        isContainerFormat && currentProvider instanceof PeroContainerProvider
          ? currentProvider
          : null
      const ysmScriptPaths = containerProvider
        ? (ysmFunctions ?? []).map(toContainerRelativePath)
        : (ysmFunctions ?? [])
      if (ysmScriptPaths.length > 0) {
        try {
          const scripts = await Promise.all(
            ysmScriptPaths.map(async (path: string) => {
              const fileName = decodeURIComponent(path.split('/').pop() || '')
              if (containerProvider) {
                const data = await containerProvider.getFile(path)
                if (!data) throw new Error(`容器内未找到脚本: ${path}`)
                return { fileName, source: new TextDecoder().decode(data) }
              }
              const res = await fetch(path)
              const source = await res.text()
              return { fileName, source }
            }),
          )
          ysmRunner = new YsmMolangRunner(scripts, (name, transition) => {
            const anim = animationLibrary.get(name)
            if (anim) animationEngine.play(anim, transition, true)
          })
          ysmRunner.init()
          logger.info('AvatarModel', `已加载 ${scripts.length} 个 YSM molang 控制器脚本`)
        } catch (e) {
          logger.warn('AvatarModel', '加载 YSM molang 控制器脚本失败', e)
        }
      }

      animList.value = animationLibrary.getNames().sort()

      // 无控制器时自动播放：YSM 并行动画（部件开关/物理模拟）+ idle。
      // YSM 的眼罩/发光眼睛/尾巴等 checkbox 按钮通过 parallel* 动画的 molang scale
      // 通道（如 v.roaming.eyeBand）控制显隐，必须持续播放这些动画开关才生效。
      if (controllerSystem.controllers.length === 0) {
        const parallelAnims = animList.value.filter((n) => /^parallel\d*$/.test(n))
        for (const name of parallelAnims) {
          const anim = animationLibrary.get(name)
          if (anim) animationEngine.play(anim, 0.1, true)
        }

        const idleAnim =
          animList.value.find((n) => n === 'idle') || animList.value.find((n) => n.includes('idle'))
        if (idleAnim) {
          const anim = animationLibrary.get(idleAnim)
          if (anim) animationEngine.play(anim, 0.2, true)
        }
      }

      // 延迟应用部件状态
      setTimeout(() => updateClothing(), 100)

      loading.value = false
      logger.info('AvatarModel', `模型 ${manifest.metadata.name} 加载成功`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('AvatarModel', '加载模型失败', e)
      errorMsg.value = `加载模型失败: ${msg}`
      loading.value = false
      // 让上层切换逻辑感知失败并执行全局兜底，而不是静默停留在旧模型。
      throw e
    }
  }

  /**
   * 加载默认 Manifest（支持 prop 注入和自动发现）
   */
  async function loadDefaultManifest(
    scene: THREE.Scene,
    propManifest?: IAvatarManifest,
    propManifestPath?: string,
  ): Promise<void> {
    if (propManifest) {
      await loadAvatar(propManifest, scene)
      return
    }

    if (propManifestPath) {
      loading.value = true
      errorMsg.value = ''
      try {
        const manifest = propManifestPath.endsWith('.pero')
          ? createPeroManifest(propManifestPath)
          : propManifestPath.endsWith('ysm.json')
            ? await loadYsmManifestFromUrl(propManifestPath)
            : await ManifestLoader.fromJson(propManifestPath)
        await loadAvatar(manifest, scene)
        return
      } catch (e: unknown) {
        logger.warn('AvatarModel', `模型入口加载失败，回退默认模型: ${propManifestPath}`, e)
      } finally {
        loading.value = false
      }
    }

    // 自动发现默认模型：统一使用蓝色大肥鱼（DeepSeek酱）。
    // 优先加载落盘 manifest，失败时直接读取 ysm.json 运行时生成清单。
    try {
      const manifest = await ManifestLoader.fromJson(DEFAULT_AVATAR_MANIFEST_PATH)
      await loadAvatar(manifest, scene)
      return
    } catch (e) {
      logger.warn('AvatarModel', '默认 manifest 加载失败，尝试 YSM 运行时清单', e)
    }

    try {
      const ysmManifest = await loadYsmManifestFromUrl(DEFAULT_AVATAR_YSM_PATH)
      await loadAvatar(ysmManifest, scene)
    } catch (e2) {
      logger.error('AvatarModel', '默认与兜底模型均加载失败', e2)
      errorMsg.value = '加载模型失败: 蓝色大肥鱼模型文件不可用'
      loading.value = false
    }
  }

  /** 为 .pero 文件创建临时 Manifest */
  function createPeroManifest(path: string): IAvatarManifest {
    return {
      metadata: {
        name: path.split('/').pop()?.replace('.pero', '') || 'Unknown',
        version: '1.0.0',
      },
      resources: { model: path, texture: path, animations: [] },
      featureButtons: [],
      parts: [],
      retargetingMap: { mapping: {} },
    }
  }

  return {
    // 响应式状态
    loading,
    errorMsg,
    animList,
    featureButtons,
    clothingState,

    // 引擎实例（供其他 composable 使用）
    retargetingManager,
    animationLibrary,
    animationEngine,
    controllerSystem,

    // Getter
    getCharacterModel: () => characterModel,
    getAdapter: () => currentAdapter,
    getMouthBone: () => mouthBone,
    getInitialEyebrowY: () => initialEyebrowY,
    /** YSM molang 运行时（每帧由渲染循环驱动） */
    getYsmRunner: () => ysmRunner,

    // 方法
    loadAvatar,
    loadDefaultManifest,
    loadControllers: () => {
      if (lastLoadedConfig) loadControllers(lastLoadedConfig, currentProvider)
    },
    updateClothing,
    initFeatureState,
    /** 显式写入单个部件开关（绕开 expose ref 解包等间接路径，保证生效并持久化） */
    setClothingPart: (id: string, value: boolean) => {
      clothingState.value[id] = value
      updateClothing()
    },
  }
}

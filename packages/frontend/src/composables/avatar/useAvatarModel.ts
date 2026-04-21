/**
 * Avatar 模型加载 Composable
 *
 * 负责根据 Manifest 选择正确的 Provider（Standard/Secure/Container），
 * 构建 3D 模型、初始化适配器和重定向管理器、加载动画。
 *
 * @module packages/frontend/src/composables/avatar/useAvatarModel
 */

import { ref } from 'vue'
import type * as THREE from 'three'
import type { IModelAdapter } from '../../components/avatar/lib/adapter/IModelAdapter'
import type { IModelProvider } from '../../components/avatar/lib/adapter/IModelProvider'
import type {
  IAvatarManifest,
  FeatureButton,
} from '../../components/avatar/lib/adapter/IAvatarManifest'
import { AvatarRenderer } from '../../components/avatar/lib/AvatarRenderer'
import { StandardBedrockProvider } from '../../components/avatar/lib/adapter/StandardBedrockProvider'
import { PeroSecureProvider } from '../../components/avatar/lib/adapter/PeroSecureProvider'
import { PeroContainerProvider } from '../../components/avatar/lib/adapter/PeroContainerProvider'
import { ManifestBasedAdapter } from '../../components/avatar/lib/adapter/ManifestBasedAdapter'
import { ManifestLoader } from '../../components/avatar/lib/adapter/ManifestLoader'
import { RetargetingManager } from '../../components/avatar/lib/retargeting/RetargetingManager'
import { AnimationLibrary } from '../../components/avatar/lib/animation/AnimationLibrary'
import { AnimationEngine } from '../../components/avatar/lib/animation/AnimationEngine'
import { AnimationControllerSystem } from '../../components/avatar/lib/animation/AnimationController'
import { StandardBones } from '../../components/avatar/lib/retargeting/RetargetingConfig'

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
  /** 嘴巴骨骼（用于口型同步） */
  let mouthBone: THREE.Object3D | null = null
  /** 眉毛骨骼初始 Y 位置 */
  let initialEyebrowY = 0

  // ═══ 部件状态管理 ═══

  /** 根据适配器的功能按钮初始化部件状态 */
  function initFeatureState(buttons: FeatureButton[]): void {
    const state: Record<string, boolean> = {}
    buttons.forEach((btn) => {
      state[btn.id] = btn.defaultValue ?? true
    })
    clothingState.value = state
    featureButtons.value = buttons
  }

  /** 更新部件可见性（委托给适配器） */
  function updateClothing(): void {
    if (!characterModel || !currentAdapter) return
    currentAdapter.applyClothingState(characterModel, clothingState.value)
  }

  // ═══ Provider 选择逻辑 ═══

  /** 根据格式自动选择 Provider */
  function createProvider(config: ModelConfig, manifest: IAvatarManifest): IModelProvider {
    const boneFilterPatterns = manifest.boneFilterPatterns

    // 容器格式：model 和 texture 都指向同一个 .pero 文件
    const isContainerFormat =
      config.model.endsWith('.pero') &&
      (config.texture?.endsWith('.pero') || config.texture === config.model)

    if (isContainerFormat) {
      console.log(`[AvatarModel] 使用容器加载器: ${manifest.metadata.name}`)
      return new PeroContainerProvider(config.model, boneFilterPatterns)
    } else if (config.model.endsWith('.pero')) {
      console.log(`[AvatarModel] 使用安全模型加载器: ${manifest.metadata.name}`)
      return new PeroSecureProvider(config, boneFilterPatterns)
    } else {
      return new StandardBedrockProvider(config, boneFilterPatterns)
    }
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
          console.log(`[AvatarModel] 从 Provider 加载了 ${controllers.size} 个动画控制器`)
          controllerSystem.loadFromJson({
            format_version: '1.10.0',
            animation_controllers: Object.fromEntries(controllers),
          } as Parameters<typeof controllerSystem.loadFromJson>[0])
        }
      } catch (e) {
        console.warn('[AvatarModel] 从 Provider 加载控制器失败:', e)
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
      const isContainerFormat =
        config.model.endsWith('.pero') &&
        (config.texture?.endsWith('.pero') || config.texture === config.model)

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
            console.log(
              `[AvatarModel] 容器 manifest 加载成功，${effectiveManifest.featureButtons?.length || 0} 个功能按钮`,
            )
          }
        } catch (e) {
          console.warn('[AvatarModel] 从容器加载 manifest 失败，使用默认配置:', e)
        }
      }

      // 构建 3D 模型
      const avatarRenderer = new AvatarRenderer()
      const rootGroup = await avatarRenderer.build(provider)

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
        initFeatureState(currentAdapter.getFeatureButtons())
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

      lastLoadedConfig = config
      await loadControllers(config)

      animList.value = animationLibrary.getNames().sort()

      // 无控制器时自动播放 idle
      if (controllerSystem.controllers.length === 0) {
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
      console.log(`[AvatarModel] 模型 ${manifest.metadata.name} 加载成功`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[AvatarModel] 加载模型失败:', e)
      errorMsg.value = `加载模型失败: ${msg}`
      loading.value = false
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
          : await ManifestLoader.fromJson(propManifestPath)
        await loadAvatar(manifest, scene)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[AvatarModel] 加载初始 manifest 失败:', e)
        errorMsg.value = `加载模型失败: ${msg}`
      } finally {
        loading.value = false
      }
      return
    }

    // 自动发现默认模型
    const isElectron = (window as unknown as Record<string, unknown>).electron !== undefined
    const prefix = isElectron ? 'assets/' : '/assets/'
    const manifestJsonPath = `${prefix}3d/Rossi/manifest.json`
    const containerPath = `${prefix}3d/Rossi.pero`

    // 优先 manifest.json（散文件夹），.pero 容器作为后备
    try {
      const manifest = await ManifestLoader.fromJson(manifestJsonPath)
      await loadAvatar(manifest, scene)
      return
    } catch (e) {
      console.warn('[AvatarModel] manifest.json 加载失败，尝试容器:', e)
    }

    try {
      await loadAvatar(createPeroManifest(containerPath), scene)
    } catch (e2) {
      console.error('[AvatarModel] 所有加载路径均失败:', e2)
      errorMsg.value = '加载模型失败: 无可用的模型文件'
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

    // 方法
    loadAvatar,
    loadDefaultManifest,
    loadControllers: () => {
      if (lastLoadedConfig) loadControllers(lastLoadedConfig, currentProvider)
    },
    updateClothing,
    initFeatureState,
  }
}

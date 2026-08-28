<template>
  <div ref="containerRef" class="bedrock-avatar-container">
    <div ref="canvasRef" class="canvas-container"></div>

    <!-- 加载遮罩 -->
    <div v-if="model.loading.value" class="avatar-overlay avatar-overlay--loading">
      <div class="avatar-overlay__spinner">
        <PixelIcon name="loader" size="md" animation="spin" />
      </div>
      <div class="avatar-overlay__text">正在召唤中...</div>
    </div>

    <!-- 错误遮罩 -->
    <div v-if="model.errorMsg.value" class="avatar-overlay avatar-overlay--error">
      <div class="avatar-overlay__error-box">
        <div class="avatar-overlay__emoji">😵</div>
        {{ model.errorMsg.value }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * BedrockAvatar — Bedrock 3D 虚拟人组件
 *
 * 纯模板壳：将渲染逻辑委托给 3 个 composable
 * - useAvatarScene — 场景/相机/灯光/OrbitControls
 * - useAvatarModel — 模型加载/适配器/动画
 * - useAvatarInteraction — 交互/头部追踪/表情/口型
 *
 * @module packages/frontend/src/components/avatar/BedrockAvatar
 */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import type { IAvatarManifest } from './lib/adapter/IAvatarManifest'
import { ManifestLoader } from './lib/adapter/ManifestLoader'
import { useAvatarScene } from '../../composables/avatar/useAvatarScene'
import { useAvatarModel } from '../../composables/avatar/useAvatarModel'
import { useAvatarInteraction } from '../../composables/avatar/useAvatarInteraction'
import type { PetEvent } from '../../composables/avatar/useAvatarInteraction'
import { loadYsmManifestFromUrl } from './lib/ysm/loadYsmManifest'
import { AVATAR_MODEL_STORAGE_KEY } from './lib/avatarDefaults'
import { logger } from '../../lib/logger'

const props = defineProps<{
  isDragging?: boolean
  manifestPath?: string
  manifest?: IAvatarManifest
}>()

const emit = defineEmits<{
  (e: 'pet', data: PetEvent): void
  (e: 'hover-start'): void
  (e: 'hover-end'): void
  (e: 'model-load-success', manifestPath: string): void
  (e: 'model-load-error', message: string): void
}>()

// ═══ DOM refs ═══
const containerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLElement | null>(null)

// ═══ Composables ═══
const sceneCtx = useAvatarScene()
const model = useAvatarModel()
const interaction = useAvatarInteraction(model.retargetingManager)

// ═══ 渲染循环 ═══
let animationFrameId = 0
let lastFrameTime = 0

function animate(): void {
  animationFrameId = requestAnimationFrame(animate)

  const now = performance.now() / 1000
  const dt = now - (lastFrameTime || now)
  lastFrameTime = now
  const safeDt = Math.min(dt, 0.1)

  // 非交互时自动重置相机角度
  sceneCtx.updateCameraReset()

  const cam = sceneCtx.camera.value
  const isAnimPaused = selectedAnim.value === '__NONE__'

  // 头部追踪 + 射线检测
  if (cam && sceneCtx.scene.value && !isAnimPaused) {
    const wasHovering = interaction.isHovering()
    interaction.updateHeadTracking(cam, model.getCharacterModel(), isAnimPaused)
    const nowHovering = interaction.isHovering()

    if (nowHovering && !wasHovering) emit('hover-start')
    else if (!nowHovering && wasHovering) emit('hover-end')
  }

  // 更新 OrbitControls
  if (sceneCtx.controls.value) sceneCtx.controls.value.update()

  // 更新动画系统
  model.controllerSystem.update(safeDt)
  model.animationEngine.update(safeDt)

  // 驱动 YSM molang 控制器脚本（20tick/s，set_animation 结果由回调接入动画引擎）
  if (!isAnimPaused) {
    const ysmRunner = model.getYsmRunner()
    if (ysmRunner?.hasScripts) {
      ysmRunner.update(safeDt)
    }
  }

  // 程序化动画覆盖（拖拽物理 / LookAt / 表情 / 口型）
  if (sceneCtx.scene.value && !isAnimPaused) {
    interaction.applyProceduralAnimations(
      !!props.isDragging,
      isAnimPaused,
      model.getInitialEyebrowY,
    )
  }

  // 渲染
  if (sceneCtx.renderer.value && sceneCtx.scene.value && cam) {
    sceneCtx.renderer.value.render(sceneCtx.scene.value, cam)
  }
}

// ═══ 动画选择 ═══
const selectedAnim = ref('')

watch(selectedAnim, (newVal) => {
  if (newVal === '__NONE__') {
    model.controllerSystem.reset()
    model.animationEngine.stop(undefined, 0)
    model.retargetingManager.reset()
    interaction.resetProceduralState()
  } else if (newVal) {
    const anim = model.animationLibrary.get(newVal)
    if (anim) {
      model.animationEngine.stop(undefined, 0.2)
      model.animationEngine.play(anim, 0.2, true)
    }
  } else {
    model.loadControllers()
  }
})

// ═══ manifest 路径变化时重新加载 ═══
/**
 * 直接加载模型入口并返回结果。
 *
 * 模型切换 UI 通过 expose 主动调用，避免依赖 prop watcher 的异步时序；失败时保留
 * 当前模型并向上层返回错误，不再静默切回默认模型造成“点击没有反应”的错觉。
 */
async function loadManifestPath(newPath: string): Promise<boolean> {
  if (!newPath || !sceneCtx.scene.value) return false

  model.loading.value = true
  model.errorMsg.value = ''
  try {
    const manifest = newPath.endsWith('ysm.json')
      ? await loadYsmManifestFromUrl(newPath)
      : await ManifestLoader.fromJson(newPath)
    await model.loadAvatar(manifest, sceneCtx.scene.value)
    localStorage.setItem(AVATAR_MODEL_STORAGE_KEY, newPath)
    emit('model-load-success', newPath)
    return true
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error('BedrockAvatar', `切换模型失败: ${newPath}`, e)
    model.errorMsg.value = `切换模型失败: ${message}`
    emit('model-load-error', message)
    return false
  } finally {
    model.loading.value = false
  }
}

// 模型切换由外观菜单通过 loadManifestPath 显式调用；初始模型由 onMounted 加载。
// 不再同时监听 manifestPath，避免一次点击触发“直接调用 + prop watcher”两次重复加载。

// ═══ 害羞状态联动 ═══
watch(
  model.clothingState,
  (state) => {
    interaction.isShy.value = !state.dress || !state.underwear
    model.updateClothing()
  },
  { deep: true },
)

// ═══ 事件处理 ═══
function handleMouseMove(event: MouseEvent): void {
  if (!containerRef.value) return
  interaction.onMouseMove(event, containerRef.value)
}

function handleMouseDown(event: MouseEvent): void {
  if (!containerRef.value || !sceneCtx.camera.value) return
  const result = interaction.onMouseDown(
    event,
    containerRef.value,
    sceneCtx.camera.value,
    model.getCharacterModel(),
  )
  if (result) emit('pet', result)
}

function handleMouseUp(event: MouseEvent): void {
  interaction.onMouseUp(event)
}

function handleResize(): void {
  sceneCtx.onResize()
}

// ═══ 生命周期 ═══
onMounted(async () => {
  if (!containerRef.value || !canvasRef.value) return

  sceneCtx.initScene(containerRef.value, canvasRef.value)

  if (sceneCtx.scene.value) {
    await model.loadDefaultManifest(sceneCtx.scene.value, props.manifest, props.manifestPath)
  }

  animate()

  window.addEventListener('resize', handleResize)
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mousedown', handleMouseDown)
  window.addEventListener('mouseup', handleMouseUp)
})

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mousedown', handleMouseDown)
  window.removeEventListener('mouseup', handleMouseUp)

  model.animationEngine.stop()
  sceneCtx.disposeScene()
})

// ═══ 辅助函数 ═══

// ═══ 暴露给父组件 ═══
defineExpose({
  /** 外观菜单使用的显式模型切换入口，返回是否加载成功。 */
  loadManifestPath,
  playAnimation: (name: string) => {
    const anim = model.animationLibrary.get(name)
    if (anim) model.animationEngine.play(anim, 0.2, true)
  },
  resetAnimation: () => model.loadControllers(),
  clothingState: model.clothingState,
  featureButtons: model.featureButtons,
  updateClothing: model.updateClothing,
  /** 显式设置单个部件开关（外观菜单使用，保证写入模型状态并持久化） */
  setClothingPart: (id: string, value: boolean) => model.setClothingPart(id, value),
  animList: model.animList,
  setAnimation: (name: string) => {
    selectedAnim.value = name
  },
  setGlobalMouse: (x: number, y: number) => {
    if (containerRef.value) interaction.setGlobalMouse(x, y, containerRef.value)
  },
  setLipSync: (val: number) => {
    interaction.lipSyncTarget.value = Math.max(0, Math.min(1, val))
  },
})
</script>

<style scoped>
.bedrock-avatar-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.canvas-container {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
}

/* 遮罩层基础 */
.avatar-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.avatar-overlay--loading {
  background: rgba(249, 168, 212, 0.05);
  backdrop-filter: blur(2px);
}

.avatar-overlay--error {
  background: rgba(239, 68, 68, 0.1);
  backdrop-filter: blur(4px);
  z-index: 20;
  padding: 16px;
}

.avatar-overlay__spinner {
  margin-bottom: 8px;
  animation: bounce 1s ease infinite;
  color: var(--color-pink-face, #ec4899);
}

.avatar-overlay__text {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-pink-face, #ec4899);
  background: rgba(255, 255, 255, 0.8);
  padding: 4px 12px;
  border: 2px solid rgba(249, 168, 212, 0.3);
}

.avatar-overlay__error-box {
  background: rgba(255, 255, 255, 0.9);
  padding: 16px;
  border: 2px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  max-width: 100%;
  word-break: break-all;
  box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.1);
}

.avatar-overlay__emoji {
  font-size: 28px;
  margin-bottom: 8px;
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}
</style>

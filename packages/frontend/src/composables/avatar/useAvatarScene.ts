/**
 * Avatar 场景管理 Composable
 *
 * 负责 Three.js 场景、相机、渲染器、灯光和 OrbitControls 的初始化、
 * 渲染循环和窗口 resize 响应。
 *
 * @module packages/frontend/src/composables/avatar/useAvatarScene
 */

import { shallowRef, onUnmounted, type Ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { AVATAR_QUALITY, type AvatarQuality } from '../../components/avatar/lib/avatarPerformance'
import { disposeAvatarResources } from '../../components/avatar/lib/disposeAvatarResources'

/** 场景配置参数 */
interface SceneOptions {
  /** 相机 FOV（度），默认 40 */
  fov?: number
  /** 相机初始位置 */
  cameraPosition?: [number, number, number]
  /** OrbitControls 观察目标 */
  lookAt?: [number, number, number]
}

/** Composable 返回值 */
interface UseAvatarSceneReturn {
  scene: Ref<THREE.Scene | null>
  camera: Ref<THREE.PerspectiveCamera | null>
  renderer: Ref<THREE.WebGLRenderer | null>
  controls: Ref<OrbitControls | null>
  /** OrbitControls 是否正在交互中 */
  isInteracting: Ref<boolean>
  /** 初始化 Three.js 场景 */
  initScene: (containerEl: HTMLElement, canvasEl: HTMLElement) => void
  /** 销毁场景，释放 GPU 资源 */
  disposeScene: () => void
  /** 处理窗口 resize */
  onResize: () => void
  setQuality: (quality: AvatarQuality) => void
  fitShadowToModel: (model: THREE.Object3D) => void
  /** 每帧自动重置相机到默认位置（非交互时） */
  updateCameraReset: (delta: number) => void
}

const DEFAULT_CAMERA_POS: [number, number, number] = [0, 20, 90]
const DEFAULT_LOOK_AT: [number, number, number] = [0, 21, 0]

export function useAvatarScene(options: SceneOptions = {}): UseAvatarSceneReturn {
  const { fov = 40, cameraPosition = DEFAULT_CAMERA_POS, lookAt = DEFAULT_LOOK_AT } = options

  const scene = shallowRef<THREE.Scene | null>(null)
  const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
  const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
  const controls = shallowRef<OrbitControls | null>(null)
  const isInteracting = shallowRef(false)

  /** 容器 DOM 引用（用于 resize） */
  let containerRef: HTMLElement | null = null
  let quality: AvatarQuality = 'balanced'
  let shadowLight: THREE.DirectionalLight | null = null
  const currentOffset = new THREE.Vector3()
  const spherical = new THREE.Spherical()
  const defaultSpherical = new THREE.Spherical().setFromVector3(new THREE.Vector3(0, -1, 70))
  const defaultTarget = new THREE.Vector3(...lookAt)

  function initScene(containerEl: HTMLElement, canvasEl: HTMLElement): void {
    disposeScene()
    containerRef = containerEl
    while (canvasEl.firstChild) {
      canvasEl.removeChild(canvasEl.firstChild)
    }

    // 场景
    const s = new THREE.Scene()
    scene.value = s

    // 相机 — 使用较窄 FOV 以获得 2D 外观 (30-45)
    // near/far 需贴近实际观察范围：模型约 47 单位高、相机约 90 单位远，
    // 0.1/1000 的比例会让深度缓冲精度被大量浪费在无用区间，导致面部多层
    // Mesh（眼睛/嘴/睫毛）出现 z-fighting 闪烁。
    const c = new THREE.PerspectiveCamera(
      fov,
      Math.max(1, containerEl.clientWidth) / Math.max(1, containerEl.clientHeight),
      1,
      200,
    )
    c.position.set(...cameraPosition)
    camera.value = c

    // 渲染器
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, AVATAR_QUALITY[quality].pixelRatio))
    r.setSize(Math.max(1, containerEl.clientWidth), Math.max(1, containerEl.clientHeight))
    r.shadowMap.enabled = true
    // 由渲染循环按预算刷新阴影，不为每个高帧率画面重复绘制阴影。
    r.shadowMap.autoUpdate = false
    r.shadowMap.needsUpdate = true
    // 像素风体素模型用硬阴影（PCFShadowMap）而非软阴影（PCFSoftShadowMap）：
    // 软阴影的 Poisson 采样核在发卡这类亚像素薄片（约 10 个阴影纹素）上会跨越
    // 薄片两侧采样，产生随摆动抽搐的噪点条纹。硬阴影采样更小更稳定，也贴合像素风硬边。
    r.shadowMap.type = THREE.PCFShadowMap
    canvasEl.appendChild(r.domElement)
    renderer.value = r

    // OrbitControls（右键旋转）
    const ctrl = new OrbitControls(c, r.domElement)
    ctrl.target.set(...lookAt)
    ctrl.enableDamping = true
    ctrl.dampingFactor = 0.05
    ctrl.enableZoom = false // 禁用滚轮缩放

    ctrl.addEventListener('start', () => {
      isInteracting.value = true
    })
    ctrl.addEventListener('end', () => {
      isInteracting.value = false
    })

    // 鼠标按钮配置
    ctrl.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE, // 禁用左键拖拽（保留给窗口拖拽）
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    }
    controls.value = ctrl

    // ═══ 灯光 ═══

    // 环境光（中等强度）
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    s.add(ambient)

    // 半球光（自然天空/地面变化）
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x202020, 0.5) // 天蓝色到深灰色
    s.add(hemi)

    // 主定向光（太阳）
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5)
    dirLight.position.set(20, 50, 30) // 更高的角度以获得更好的阴影
    dirLight.castShadow = true
    // 阴影范围在模型加载后收紧，使均衡档也能保留小部件的阴影精度。
    dirLight.shadow.mapSize.setScalar(AVATAR_QUALITY[quality].shadowSize)
    shadowLight = dirLight
    // DirectionalLight 的阴影相机默认只覆盖 ±5 的正交范围，而模型高约 47、宽约 30，
    // 超出部分会被阴影贴图错误采样/裁剪，在衣服内侧等复杂区域形成“花屏错乱影子”。
    // 这里按模型实际尺寸设置阴影相机范围，让 shadow map 精度集中在角色本体。
    dirLight.shadow.camera.left = -40
    dirLight.shadow.camera.right = 40
    dirLight.shadow.camera.top = 40
    dirLight.shadow.camera.bottom = -40
    // 阴影相机的 near/far 需贴合模型到光源的实际深度（约 18~79）：
    // 拉成 1/200 会把深度精度浪费在空白区间，导致小物件自阴影 acne；
    // near 必须小于模型最近点，否则靠近光源的部分会被阴影相机裁掉。
    dirLight.shadow.camera.near = 10
    dirLight.shadow.camera.far = 90
    dirLight.target.position.set(0, 0, 0)
    // 负 bias 会把阴影采样拉向光源，加剧面部等自阴影区域的 shadow acne（闪烁）；
    // 这里改为 0，并靠 normalBias 消除偏移伪影。
    // normalBias 不能过大：发卡这类亚像素薄片（约 0.2 单位）会被 0.2 的偏移
    // 直接把阴影“顶”到薄片另一侧，摆动时看起来像影子在发卡上抽搐。0.05 ≈ 2~3 个阴影纹素，够用且不会脱离。
    dirLight.shadow.bias = 0
    dirLight.shadow.normalBias = 0.05 // 减少阴影伪影
    s.add(dirLight)
    s.add(dirLight.target)

    // 补光灯（柔化刺眼的阴影）
    const fillLight = new THREE.DirectionalLight(0xffeedd, 0.5) // 暖色补光
    fillLight.position.set(-20, 20, 20)
    s.add(fillLight)

    // 轮廓光（背光用于分离）
    const rimLight = new THREE.SpotLight(0xffffff, 1.0)
    rimLight.position.set(0, 40, -30)
    rimLight.lookAt(0, 10, 0)
    s.add(rimLight)

    // 地面（阴影捕捉器 — 不可见但接收阴影）
    const groundGeo = new THREE.PlaneGeometry(100, 100)
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0
    ground.receiveShadow = true
    s.add(ground)
  }

  function setQuality(value: AvatarQuality): void {
    if (quality === value) return
    quality = value
    if (shadowLight) {
      shadowLight.shadow.mapSize.setScalar(AVATAR_QUALITY[value].shadowSize)
      shadowLight.shadow.map?.dispose()
      shadowLight.shadow.map = null
    }
    if (renderer.value) renderer.value.shadowMap.needsUpdate = true
    onResize()
  }

  /** 只在加载或画质变化时计算，预留动作余量，避免逐帧拟合导致阴影抖动。 */
  function fitShadowToModel(model: THREE.Object3D): void {
    if (!shadowLight) return
    model.updateWorldMatrix(true, true)
    const bounds = new THREE.Box3().setFromObject(model)
    if (bounds.isEmpty()) return
    shadowLight.updateMatrixWorld(true)
    shadowLight.target.updateMatrixWorld(true)
    shadowLight.shadow.updateMatrices(shadowLight)
    const camera = shadowLight.shadow.camera
    const lightBounds = new THREE.Box3()
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          lightBounds.expandByPoint(
            new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse),
          )
    const size = lightBounds.getSize(new THREE.Vector3())
    const padding = Math.max(5, size.x * 0.2, size.y * 0.2)
    camera.left = lightBounds.min.x - padding
    camera.right = lightBounds.max.x + padding
    camera.bottom = lightBounds.min.y - padding
    camera.top = lightBounds.max.y + padding
    camera.near = Math.max(0.1, -lightBounds.max.z - padding)
    camera.far = Math.max(camera.near + 1, -lightBounds.min.z + padding)
    camera.updateProjectionMatrix()
    if (renderer.value) renderer.value.shadowMap.needsUpdate = true
  }

  /** 窗口 resize 响应 */
  function onResize(): void {
    if (!containerRef || !camera.value || !renderer.value) return

    const width = containerRef.clientWidth
    const height = containerRef.clientHeight
    if (!width || !height) return

    camera.value.aspect = width / height
    camera.value.updateProjectionMatrix()
    renderer.value.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, AVATAR_QUALITY[quality].pixelRatio),
    )
    renderer.value.setSize(width, height)
  }

  /**
   * 非交互时自动将相机缓慢重置到默认角度
   *
   * 使用球面坐标插值实现平滑回正，保持当前缩放半径不变。
   */
  function updateCameraReset(delta: number): void {
    if (isInteracting.value || !controls.value || !camera.value) return

    currentOffset.copy(camera.value.position).sub(controls.value.target)
    spherical.setFromVector3(currentOffset)
    const blend = 1 - Math.pow(0.95, delta * 60)

    // Theta 环绕处理（取最短路径）
    let diff = defaultSpherical.theta - spherical.theta
    if (diff > Math.PI) diff -= 2 * Math.PI
    else if (diff < -Math.PI) diff += 2 * Math.PI

    spherical.theta += diff * blend
    spherical.phi += (defaultSpherical.phi - spherical.phi) * blend

    currentOffset.setFromSpherical(spherical)
    camera.value.position.copy(controls.value.target).add(currentOffset)

    // 目标也缓慢回正
    controls.value.target.lerp(defaultTarget, blend)
  }

  /** 销毁场景 */
  function disposeScene(): void {
    controls.value?.dispose()
    if (scene.value) disposeAvatarResources(scene.value)
    if (renderer.value) {
      renderer.value.domElement.remove()
      renderer.value.dispose()
      renderer.value.forceContextLoss()
      renderer.value = null
    }
    scene.value = null
    camera.value = null
    controls.value = null
    shadowLight = null
    isInteracting.value = false
    containerRef = null
  }

  onUnmounted(disposeScene)

  return {
    scene,
    camera,
    renderer,
    controls,
    isInteracting: isInteracting as unknown as Ref<boolean>,
    initScene,
    disposeScene,
    onResize,
    setQuality,
    fitShadowToModel,
    updateCameraReset,
  }
}

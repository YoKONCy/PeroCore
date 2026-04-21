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
  /** 每帧自动重置相机到默认位置（非交互时） */
  updateCameraReset: () => void
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

  function initScene(containerEl: HTMLElement, canvasEl: HTMLElement): void {
    containerRef = containerEl

    // 清理已有渲染器
    if (renderer.value) {
      renderer.value.dispose()
    }
    while (canvasEl.firstChild) {
      canvasEl.removeChild(canvasEl.firstChild)
    }

    // 场景
    const s = new THREE.Scene()
    scene.value = s

    // 相机 — 使用较窄 FOV 以获得 2D 外观 (30-45)
    const c = new THREE.PerspectiveCamera(
      fov,
      containerEl.clientWidth / containerEl.clientHeight,
      0.1,
      1000,
    )
    c.position.set(...cameraPosition)
    camera.value = c

    // 渲染器
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    r.setSize(containerEl.clientWidth, containerEl.clientHeight)
    // 限制最大 2 倍像素比，平衡清晰度与性能
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFSoftShadowMap
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
    dirLight.shadow.mapSize.width = 2048
    dirLight.shadow.mapSize.height = 2048
    dirLight.shadow.bias = -0.0001
    dirLight.shadow.normalBias = 0.05 // 减少阴影伪影
    s.add(dirLight)

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

  /** 窗口 resize 响应 */
  function onResize(): void {
    if (!containerRef || !camera.value || !renderer.value) return

    const width = containerRef.clientWidth
    const height = containerRef.clientHeight

    camera.value.aspect = width / height
    camera.value.updateProjectionMatrix()
    renderer.value.setSize(width, height)
    renderer.value.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }

  /**
   * 非交互时自动将相机缓慢重置到默认角度
   *
   * 使用球面坐标插值实现平滑回正，保持当前缩放半径不变。
   */
  function updateCameraReset(): void {
    if (isInteracting.value || !controls.value || !camera.value) return

    const currentOffset = new THREE.Vector3().copy(camera.value.position).sub(controls.value.target)
    const spherical = new THREE.Spherical().setFromVector3(currentOffset)

    // 默认方向的球面坐标
    // 相对于目标点的偏移：(0, -1, 70)
    const defaultOffset = new THREE.Vector3(0, -1, 70)
    const defaultSpherical = new THREE.Spherical().setFromVector3(defaultOffset)

    // Theta 环绕处理（取最短路径）
    let diff = defaultSpherical.theta - spherical.theta
    if (diff > Math.PI) diff -= 2 * Math.PI
    else if (diff < -Math.PI) diff += 2 * Math.PI

    spherical.theta += diff * 0.05
    spherical.phi += (defaultSpherical.phi - spherical.phi) * 0.05

    const newOffset = new THREE.Vector3().setFromSpherical(spherical)
    camera.value.position.copy(controls.value.target).add(newOffset)

    // 目标也缓慢回正
    const defaultTarget = new THREE.Vector3(...lookAt)
    controls.value.target.lerp(defaultTarget, 0.05)
  }

  /** 销毁场景 */
  function disposeScene(): void {
    if (renderer.value) {
      renderer.value.dispose()
      renderer.value = null
    }
    scene.value = null
    camera.value = null
    controls.value = null
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
    updateCameraReset,
  }
}

/**
 * Avatar 交互 Composable
 *
 * 负责所有用户交互逻辑：
 * - 鼠标追踪（头部跟随 LookAt）
 * - 射线检测（Raycaster 悬停/点击）
 * - 拖拽物理效果（被拎起时的身体摆动）
 * - 表情控制（眯眼、眉毛、口型同步）
 *
 * @module packages/frontend/src/composables/avatar/useAvatarInteraction
 */

import { ref } from 'vue'
import * as THREE from 'three'
import type { RetargetingManager } from '../../components/avatar/lib/retargeting/RetargetingManager'
import { StandardBones } from '../../components/avatar/lib/retargeting/RetargetingConfig'
import { molangContext } from '../../components/avatar/lib/Molang'

/** 触摸/点击事件数据 */
export interface PetEvent {
  /** 身体部位类型 */
  type: 'head' | 'body' | 'arm' | 'leg'
  /** 原始骨骼名称 */
  rawPart: string
}

/** 身体部位判定关键字映射 */
const PART_KEYWORDS: Record<string, string[]> = {
  head: ['Head', 'Hair', 'Hat', 'Ribbon', 'Face', 'Eye'],
  arm: ['Arm', 'Hand', 'Sleeve'],
  leg: ['Leg', 'Foot', 'Shoe', 'Boot', 'Sock'],
  body: ['Chest', 'Waist', 'Body', 'Dress', 'Skirt', 'Cloth', 'Apron', 'Breast'],
}

/** 所有可点击的骨骼关键字 */
const ALL_CLICKABLE_KEYWORDS = Object.values(PART_KEYWORDS).flat()

export function useAvatarInteraction(retargetingManager: RetargetingManager) {
  // ═══ 响应式状态 ═══
  const lipSyncTarget = ref(0)
  const currentLipSync = ref(0)
  const isShy = ref(false)

  // ═══ 非响应式状态 ═══
  let targetHeadX = 0
  let targetHeadY = 0
  let currentHeadX = 0
  let currentHeadY = 0
  let mouseInputX = 0
  let mouseInputY = 0
  let dragInfluence = 0
  let isHovering = false
  let isPetting = false
  let currentSquint = 1.0
  let initialEyelidScaleY = 1.0
  let eyelidInitialized = false
  let currentEyebrowOffset = 0

  const raycaster = new THREE.Raycaster()
  const mouseNDC = new THREE.Vector2(999, 999) // 默认在屏幕外

  // ═══ 鼠标事件处理 ═══

  /** 处理鼠标移动（更新头部追踪输入和 Raycaster NDC） */
  function onMouseMove(event: MouseEvent, containerEl: HTMLElement): void {
    const rect = containerEl.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    // 计算相对于中心的鼠标位置 (-1 到 1)
    const rawX = (event.clientX - centerX) / (rect.width / 2)
    const rawY = (event.clientY - centerY) / (rect.height / 2)

    mouseInputX = Math.max(-1, Math.min(1, rawX))
    mouseInputY = Math.max(-1, Math.min(1, rawY))

    // 更新 Raycaster NDC (Y 方向反转)
    mouseNDC.set(mouseInputX, -mouseInputY)
  }

  /** 处理鼠标按下（射线检测点击） */
  function onMouseDown(
    event: MouseEvent,
    containerEl: HTMLElement,
    camera: THREE.PerspectiveCamera,
    characterModel: THREE.Object3D | null,
  ): PetEvent | null {
    if (event.button !== 0 || !characterModel) return null

    const rect = containerEl.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    const clickNDC = new THREE.Vector2(x, y)

    raycaster.setFromCamera(clickNDC, camera)
    const intersects = raycaster.intersectObject(characterModel, true)

    if (intersects.length === 0) return null

    // 向上遍历查找可识别骨骼
    let currentObj: THREE.Object3D | null = intersects[0]!.object
    let partName = ''

    for (let i = 0; i < 5 && currentObj; i++) {
      if (currentObj.name && ALL_CLICKABLE_KEYWORDS.some((kw) => currentObj!.name.includes(kw))) {
        partName = currentObj.name
        break
      }
      currentObj = currentObj.parent
    }

    if (!partName) return null

    isPetting = true

    // 判定身体部位类型
    let type: PetEvent['type'] = 'body'
    for (const [partType, keywords] of Object.entries(PART_KEYWORDS)) {
      if (keywords.some((kw) => partName.includes(kw))) {
        type = partType as PetEvent['type']
        break
      }
    }

    return { type, rawPart: partName }
  }

  /** 处理鼠标释放 */
  function onMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      isPetting = false
    }
  }

  /** 外部设置全局鼠标位置（用于窗口外追踪） */
  function setGlobalMouse(x: number, y: number, containerEl: HTMLElement): void {
    const rect = containerEl.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    const rawX = (x - centerX) / (rect.width / 2)
    const rawY = (y - centerY) / (rect.height / 2)

    mouseInputX = Math.max(-1, Math.min(1, rawX))
    mouseInputY = Math.max(-1, Math.min(1, rawY))
    mouseNDC.set(rawX, -rawY)
  }

  // ═══ 每帧更新 ═══

  /**
   * 更新头部追踪逻辑
   *
   * 基于相机位置和鼠标偏移计算头部目标角度，
   * 通过插值平滑过渡，更新 Molang 变量。
   */
  function updateHeadTracking(
    camera: THREE.PerspectiveCamera,
    characterModel: THREE.Object3D | null,
    isAnimationPaused: boolean,
  ): void {
    if (isAnimationPaused) return

    // 射线检测悬停
    if (characterModel) {
      raycaster.setFromCamera(mouseNDC, camera)
      const intersects = raycaster.intersectObject(characterModel, true)
      isHovering = intersects.length > 0
    }

    // ─── 头部追踪角度计算 ───
    // 从头部到相机的向量
    const headBone = retargetingManager.getBone(StandardBones.Head)
    const headPos = headBone
      ? headBone.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(0, 24, 0)
    const camPos = camera.position

    const dx = camPos.x - headPos.x
    const dy = camPos.y - headPos.y
    const dz = camPos.z - headPos.z

    // 偏航角 (Y 轴旋转)
    const camYaw = Math.atan2(dx, dz) * (180 / Math.PI)

    // 俯仰角 (X 轴旋转)
    const hDist = Math.sqrt(dx * dx + dz * dz)
    const camPitch = Math.atan2(dy, hDist) * (180 / Math.PI)

    // 鼠标偏移
    const maxMouseAngle = 15
    const maxHeadAngle = 45

    // 悬停时取消鼠标影响
    const effectiveMouseX = isHovering ? 0 : mouseInputX
    const effectiveMouseY = isHovering ? 0 : mouseInputY

    // 结合相机角度和鼠标偏移
    const totalYaw = camYaw + effectiveMouseX * maxMouseAngle
    const totalPitch = camPitch + effectiveMouseY * maxMouseAngle * -1

    targetHeadY = Math.max(-maxHeadAngle, Math.min(maxHeadAngle, totalYaw))
    targetHeadX = Math.max(-maxHeadAngle, Math.min(maxHeadAngle, totalPitch))

    // 平滑插值
    const lerpFactor = 0.1
    currentHeadX += (targetHeadX - currentHeadX) * lerpFactor
    currentHeadY += (targetHeadY - currentHeadY) * lerpFactor

    // 更新 Molang 变量
    molangContext.query.head_x_rotation = currentHeadX
    molangContext.query.head_y_rotation = currentHeadY
  }

  /**
   * 应用程序化动画覆盖
   *
   * 在动画引擎更新后叠加：拖拽物理、LookAt、表情控制。
   */
  function applyProceduralAnimations(
    isDragging: boolean,
    isAnimationPaused: boolean,
    getInitialEyebrowY: () => number,
  ): void {
    if (isAnimationPaused) return

    // ─── 拖拽物理效果 ───
    const targetInfluence = isDragging ? 1.0 : 0.0
    dragInfluence += (targetInfluence - dragInfluence) * 0.1

    if (dragInfluence > 0.01) {
      applyDragPhysics()
    }

    // ─── 头部 LookAt ───
    if (dragInfluence < 0.9) {
      applyHeadLookAt()
    }

    // ─── 表情控制 ───
    applyExpressions(isDragging, getInitialEyebrowY)

    // ─── 口型同步 ───
    applyLipSync()
  }

  /** 拖拽时的身体物理效果（被拎起的摆动） */
  function applyDragPhysics(): void {
    const time = Date.now() * 0.008
    const swingX = Math.sin(time) * 0.1
    const swingZ = Math.cos(time * 0.8) * 0.05

    const body =
      retargetingManager.getBone(StandardBones.Body) || retargetingManager.getBone('AllBody')
    const upperBody = retargetingManager.getBone('UpperBody')
    const armL = retargetingManager.getBone(StandardBones.LeftArm)
    const armR = retargetingManager.getBone(StandardBones.RightArm)
    const legL = retargetingManager.getBone(StandardBones.LeftLeg)
    const legR = retargetingManager.getBone(StandardBones.RightLeg)
    const head = retargetingManager.getBone(StandardBones.Head)

    // 身体前倾 + 摆动
    const bodyTarget = body || upperBody
    if (bodyTarget) {
      bodyTarget.rotation.x = THREE.MathUtils.lerp(
        bodyTarget.rotation.x,
        THREE.MathUtils.degToRad(15) + swingX * 0.5,
        dragInfluence,
      )
      bodyTarget.rotation.z = THREE.MathUtils.lerp(bodyTarget.rotation.z, swingZ, dragInfluence)
    }

    // 手臂松弛下垂
    if (armL) {
      armL.rotation.z = THREE.MathUtils.lerp(
        armL.rotation.z,
        THREE.MathUtils.degToRad(20),
        dragInfluence,
      )
      armL.rotation.x = THREE.MathUtils.lerp(
        armL.rotation.x,
        THREE.MathUtils.degToRad(10) + swingX,
        dragInfluence,
      )
    }
    if (armR) {
      armR.rotation.z = THREE.MathUtils.lerp(
        armR.rotation.z,
        THREE.MathUtils.degToRad(-20),
        dragInfluence,
      )
      armR.rotation.x = THREE.MathUtils.lerp(
        armR.rotation.x,
        THREE.MathUtils.degToRad(10) + swingX,
        dragInfluence,
      )
    }

    // 腿部垂直下垂
    if (legL) {
      legL.rotation.x = THREE.MathUtils.lerp(
        legL.rotation.x,
        THREE.MathUtils.degToRad(15) + swingX * 1.5,
        dragInfluence,
      )
      legL.rotation.z = THREE.MathUtils.lerp(
        legL.rotation.z,
        THREE.MathUtils.degToRad(5),
        dragInfluence,
      )
    }
    if (legR) {
      legR.rotation.x = THREE.MathUtils.lerp(
        legR.rotation.x,
        THREE.MathUtils.degToRad(15) + swingX * 1.5,
        dragInfluence,
      )
      legR.rotation.z = THREE.MathUtils.lerp(
        legR.rotation.z,
        THREE.MathUtils.degToRad(-5),
        dragInfluence,
      )
    }

    // 头部向上看 — 试图看谁抓住了她
    if (head) {
      head.rotation.x = THREE.MathUtils.lerp(
        head.rotation.x,
        THREE.MathUtils.degToRad(-45),
        dragInfluence,
      )
      head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, swingZ * 0.5, dragInfluence)
    }
  }

  /** 通用 LookAt 叠加 */
  function applyHeadLookAt(): void {
    const head = retargetingManager.getBone(StandardBones.Head)
    if (!head) return

    // currentHeadX/Y 是角度 (Degree)
    // Bedrock 坐标系通常是 ZYX 顺序
    // Pitch (上下) -> X 轴, Yaw (左右) -> Y 轴
    const lookAtX = THREE.MathUtils.degToRad(currentHeadX)
    const lookAtY = THREE.MathUtils.degToRad(currentHeadY)

    const lookAtEuler = new THREE.Euler(lookAtX, lookAtY, 0, 'ZYX')
    const lookAtQuat = new THREE.Quaternion().setFromEuler(lookAtEuler)

    // 叠加到当前旋转（局部旋转）
    head.quaternion.multiply(lookAtQuat)
  }

  /** 表情控制（眼皮、眉毛） */
  function applyExpressions(isDragging: boolean, getInitialEyebrowY: () => number): void {
    const leftEyelid =
      retargetingManager.getBone('LeftEyelid') || retargetingManager.getBone('LeftEyelidBase')
    const rightEyelid =
      retargetingManager.getBone('RightEyelid') || retargetingManager.getBone('RightEyelidBase')
    const eyeBrow = retargetingManager.getBone('EyeBrow')

    // 首帧记录睫毛初始 scale.y
    if (!eyelidInitialized && (leftEyelid || rightEyelid)) {
      initialEyelidScaleY = leftEyelid?.scale.y ?? rightEyelid?.scale.y ?? 1.0
      eyelidInitialized = true
    }

    // 目标缩放：1.0=正常, <1=眯眼, >1=睁大
    let targetSquint = isPetting ? 0.7 : isShy.value ? 0.85 : 1.0
    if (isDragging) targetSquint = 1.2

    currentSquint += (targetSquint - currentSquint) * 0.2

    if (leftEyelid) leftEyelid.scale.y = initialEyelidScaleY * currentSquint
    if (rightEyelid) rightEyelid.scale.y = initialEyelidScaleY * currentSquint

    // 眉毛动画
    if (eyeBrow) {
      const initY = getInitialEyebrowY()
      if (initY === 0 && eyeBrow.position.y !== 0) {
        // 侧信道修正：首次获取
      }
      const targetOffset = isPetting ? -1.5 : isShy.value ? 0.5 : 0
      currentEyebrowOffset += (targetOffset - currentEyebrowOffset) * 0.2
      eyeBrow.position.y = initY + currentEyebrowOffset
    }
  }

  /** 口型同步 */
  function applyLipSync(): void {
    const mouth = retargetingManager.getBone(StandardBones.Mouth)
    if (!mouth) return

    currentLipSync.value += (lipSyncTarget.value - currentLipSync.value) * 0.3
    const maxOpenAngle = THREE.MathUtils.degToRad(30)
    mouth.rotation.x = currentLipSync.value * maxOpenAngle
  }

  /** 重置所有程序化动画状态 */
  function resetProceduralState(): void {
    currentHeadX = 0
    currentHeadY = 0
    targetHeadX = 0
    targetHeadY = 0
    molangContext.query.head_x_rotation = 0
    molangContext.query.head_y_rotation = 0
    currentSquint = 1.0
    currentEyebrowOffset = 0
    currentLipSync.value = 0
  }

  return {
    // 响应式状态
    lipSyncTarget,
    currentLipSync,
    isShy,
    isHovering: () => isHovering,

    // 事件处理
    onMouseMove,
    onMouseDown,
    onMouseUp,
    setGlobalMouse,

    // 每帧更新
    updateHeadTracking,
    applyProceduralAnimations,
    resetProceduralState,
  }
}

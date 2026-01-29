<template>
  <div ref="container" class="bedrock-avatar-container">
    <div ref="canvasContainer" class="canvas-container"></div>
    <div v-if="loading" class="loading-overlay">
      Loading 3D Model...
    </div>
    <div v-if="errorMsg" class="error-overlay">
      {{ errorMsg }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BedrockLoader } from './lib/BedrockLoader';
import { AnimationManager } from './lib/AnimationManager';
import { molangContext } from './lib/Molang';

const emit = defineEmits(['pet', 'hover-start', 'hover-end']);

const container = ref<HTMLElement | null>(null);
const canvasContainer = ref<HTMLElement | null>(null);
const loading = ref(true);
const errorMsg = ref('');
const animList = ref<string[]>([]);
const selectedAnim = ref('');

const clothingState = ref({
  dress: true,
  armour: true,
  hat: true,
  underwear: true,
  censored: false // Force hide red blocks by default
  // 默认强制隐藏红色方块
});

// Derived state for expressions
// 表情的派生状态
const isShy = ref(false);

const updateClothing = () => {
  if (!characterModel) return;
  
  // Calculate Shy State: If dress is removed, she becomes shy
  // 计算害羞状态：如果裙子被脱掉，她会变害羞
  isShy.value = !clothingState.value.dress || !clothingState.value.underwear;

  characterModel.traverse((child: any) => {
    // Check if it's a mesh or group that might represent a part
    // 检查它是否是可能代表部件的网格或组
    // BedrockLoader uses names from main.json
    // BedrockLoader 使用 main.json 中的名称
    const name = child.name;
    if (!name) return;

    if (name.includes('Dress') || name.includes('BreastDress')) {
      child.visible = clothingState.value.dress;
    } else if (name.includes('Armour')) {
      child.visible = clothingState.value.armour;
    } else if (name.includes('Hat')) {
      child.visible = clothingState.value.hat;
    } else if (name.toLowerCase().includes('underwear')) {
      child.visible = clothingState.value.underwear;
    } else if (name.includes('Censored')) {
      child.visible = clothingState.value.censored;
    } else if (name.includes('embarrassed')) {
       // Toggle Blush visibility based on shy state
       // 根据害羞状态切换腮红可见性
       child.visible = isShy.value;
       
       // Fix: Move blush slightly forward to prevent z-fighting
       // 修复：将腮红稍微向前移动，以防止 z-fighting
       // Head face is around Z = -3.5. Embarrassed default Z is -2.5 (inside). 
       if (child.position.z > -3.0) {
           child.position.z -= 1.2;
       }
     }
   });
 };

watch(clothingState, () => {
  updateClothing();
}, { deep: true });

// Expose methods for parent component
// 暴露给父组件的方法
defineExpose({
  playAnimation: (name: string) => {
    animManager.playDebug(name);
  },
  resetAnimation: () => {
    // Reset to idle or controller logic
    // 重置为空闲或控制器的逻辑
    if (animList.value.includes('idle')) {
      animManager.playDebug('idle');
    }
  },
  // Expose state for parent UI
  clothingState,
  updateClothing,
  animList,
  setAnimation: (name: string) => {
    selectedAnim.value = name;
  },
  setGlobalMouse: (x: number, y: number) => {
    if (!container.value) return;
    const rect = container.value.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const rawX = (x - centerX) / (rect.width / 2);
    const rawY = (y - centerY) / (rect.height / 2);
    
    // Allow slightly wider range for global tracking? Or keep clamped?
    // 允许稍宽的全局追踪范围？还是保持限制？
    mouseInputX = Math.max(-1, Math.min(1, rawX));
    mouseInputY = Math.max(-1, Math.min(1, rawY));
    
    // Update NDC for raycaster with RAW values
    // 使用原始值更新 Raycaster 的 NDC
    mouseNDC.set(rawX, -rawY);
  },
  setLipSync: (val: number) => {
    lipSyncTarget.value = Math.max(0, Math.min(1, val));
  }
});

// 头部追踪状态
let targetHeadX = 0;
let targetHeadY = 0;
let currentHeadX = 0;
let currentHeadY = 0;

// 射线检测 / 交互状态
let characterModel: THREE.Object3D | null = null;
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2(999, 999); // 默认在屏幕外
let isHovering = false;
let isPetting = false;
let currentSquint = 1.0;
let initialEyebrowY = 0;
let currentEyebrowOffset = 0;
// Lip Sync State
// 口型同步状态
const lipSyncTarget = ref(0);
const currentLipSync = ref(0);
let mouthBone: THREE.Object3D | null = null;

// Three.js 对象
const scene = shallowRef<THREE.Scene | null>(null);
const camera = shallowRef<THREE.PerspectiveCamera | null>(null);
const renderer = shallowRef<THREE.WebGLRenderer | null>(null);
const controls = shallowRef<OrbitControls | null>(null);
const animManager = new AnimationManager();
const loader = new BedrockLoader();

watch(selectedAnim, (newVal) => {
  if (newVal) {
    animManager.playDebug(newVal);
  } else {
    // Stop debug or reset? 
    // 停止调试或重置？
    // Ideally we might want to revert to controller logic, but playDebug overrides it.
    // 理想情况下，我们可能希望恢复控制器逻辑，但 playDebug 会覆盖它。
  }
});

let animationFrameId: number;

onMounted(async () => {
  initThree();
  await loadRossi();
  animate();
  
  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
});

onUnmounted(() => {
  cancelAnimationFrame(animationFrameId);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mousedown', onMouseDown);
  window.removeEventListener('mouseup', onMouseUp);
  
  // Cleanup
  // 清理
  if (renderer.value) {
    renderer.value.dispose();
  }
  animManager.stop();
});

function initThree() {
  if (!container.value || !canvasContainer.value) return;

  // Cleanup existing renderer to avoid duplicate canvases
  // 清理现有的渲染器以避免重复的画布
  if (renderer.value) {
    renderer.value.dispose();
  }
  
  // Clear canvas container content only
  // 仅清除画布容器内容
  while (canvasContainer.value.firstChild) {
    canvasContainer.value.removeChild(canvasContainer.value.firstChild);
  }
  
  // Reset character reference since we are creating a new scene
  // 重置角色引用，因为我们要创建一个新场景
  characterModel = null;

  // 1. Scene
  // 1. 场景
  const s = new THREE.Scene();
  scene.value = s;

  // 2. Camera
  // 2. 相机
  // Use narrower FOV for 2D look (30-45)
  // 使用较窄的 FOV 以获得 2D 外观 (30-45)
  const c = new THREE.PerspectiveCamera(40, container.value.clientWidth / container.value.clientHeight, 0.1, 1000);
  // Default View: Height 20, Dist 70, Target Y 21
  // 默认视图：高度 20，距离 70，目标 Y 21
  // Increased Z to 90 to zoom out (make model smaller)
  // 增加 Z 到 90 以缩小（使模型更小）
  c.position.set(0, 20, 90); 
  camera.value = c;

  // 3. Renderer
  // 3. 渲染器
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  r.setSize(container.value.clientWidth, container.value.clientHeight);
  r.setPixelRatio(window.devicePixelRatio);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasContainer.value.appendChild(r.domElement);
  renderer.value = r;

  // 4. Controls (Right click to rotate, as per doc)
  // 4. 控制器（右键旋转，根据文档）
  const ctrl = new OrbitControls(c, r.domElement);
  ctrl.target.set(0, 21, 0); // Look at Chest/Neck (Y=21)
  ctrl.enableDamping = true;
  ctrl.dampingFactor = 0.05;
  ctrl.enableZoom = false; // Disable zoom (scroll wheel)
  
  // Track interaction state
  // 追踪交互状态
  ctrl.addEventListener('start', () => {
    isInteracting = true;
  });
  
  ctrl.addEventListener('end', () => {
    isInteracting = false;
  });
  
  // Mouse button config
  // 鼠标按钮配置
  ctrl.mouseButtons = {
      LEFT: null, // Disable left drag (reserved for window drag)
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
  }
  controls.value = ctrl;

  // 5. Realistic Lighting Setup
  // 5. 逼真的灯光设置
  // Ambient Light (Moderate intensity)
  // 环境光（中等强度）
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  s.add(ambient);

  // Hemisphere Light (Natural sky/ground variation)
  // 半球光（自然天空/地面变化）
  const hemi = new THREE.HemisphereLight(0xddeeff, 0x202020, 0.5); // Sky blue to dark gray
  s.add(hemi);

  // Main Directional Light (Sun)
  // 主定向光（太阳）
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(20, 50, 30); // Higher angle for better shadows
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.bias = -0.0001;
  dirLight.shadow.normalBias = 0.05; // Reduces shadow acne
  s.add(dirLight);

  // Fill Light (Softens harsh shadows)
  // 补光灯（柔化刺眼的阴影）
  const fillLight = new THREE.DirectionalLight(0xffeedd, 0.5); // Warm fill
  fillLight.position.set(-20, 20, 20);
  s.add(fillLight);

  // Rim Light (Backlight for separation)
  // 轮廓光（背光用于分离）
  const rimLight = new THREE.SpotLight(0xffffff, 1.0);
  rimLight.position.set(0, 40, -30);
  rimLight.lookAt(0, 10, 0);
  s.add(rimLight);
  
  // Ground (Shadow Catcher - Invisible but receives shadow)
  // 地面（阴影捕捉器 - 不可见但接收阴影）
  const groundGeo = new THREE.PlaneGeometry(100, 100);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  s.add(ground);
}

async function loadRossi() {
  if (!scene.value) return;

  try {
    // Detect environment to set correct path prefix
    // 检测环境以设置正确的路径前缀
    const isElectron = (window as any).electron !== undefined;
    const prefix = isElectron ? 'assets/' : '/assets/';

    const config = {
      name: "Rossi",
      model: `${prefix}3d/Rossi/models/main.json`,
      texture: `${prefix}3d/Rossi/textures/texture.png`,
      animation: [
        `${prefix}3d/Rossi/animations/main.animation.json`,
        `${prefix}3d/Rossi/animations/tac.animation.json`,
        `${prefix}3d/Rossi/animations/carryon.animation.json`,
        `${prefix}3d/Rossi/animations/extra.animation.json`,
        `${prefix}3d/Rossi/animations/tlm.animation.json`
      ],
      animation_controllers: `${prefix}3d/Rossi/controller/controller.json`
    };
    
    // NOTE: Paths must be correct relative to 'public'
    // I copied PeroCore/View3D/assets/Rossi to public/assets/3d/Rossi
    // 注意：路径必须相对于 'public' 是正确的
    
    // Clear existing scene objects to prevent duplication
    // 清除现有的场景对象以防止重复
    if (characterModel && scene.value) {
        scene.value.remove(characterModel);
        characterModel = null;
    }
    
    const rootGroup = await loader.load(config, animManager);
    characterModel = rootGroup;

    // Cache Bones for Procedural Animation
    // 缓存骨骼用于程序化动画
    mouthBone = rootGroup.getObjectByName('Mouth') || null;
    const eyeBrow = rootGroup.getObjectByName('EyeBrow');
    if (eyeBrow) {
        initialEyebrowY = eyeBrow.position.y;
    }

    scene.value.add(rootGroup);
    
    // Populate animation list for debug
    // 填充调试用的动画列表
    animList.value = Object.keys(animManager.animations).sort();
    
    // Auto-select 'idle' if available
    // 如果可用，自动选择 'idle'
    if (animList.value.includes('idle')) {
      selectedAnim.value = 'idle';
    }

    // Initial clothing update (hide censored parts)
    // 初始服装更新（隐藏审查部分）
    setTimeout(() => {
      updateClothing();
    }, 100);

    loading.value = false;
    console.log("Rossi loaded successfully");
  } catch (e: any) {
    console.error("Failed to load Rossi", e);
    errorMsg.value = "Failed to load Rossi: " + (e.message || e);
    loading.value = false;
  }
}

let isInteracting = false;

function animate() {
  animationFrameId = requestAnimationFrame(animate);
  
  // Auto-reset camera if not interacting
  // 如果没有交互，自动重置相机
  if (!isInteracting && controls.value && camera.value) {
    // Current offset from target
    // 当前偏离目标的偏移量
    const currentOffset = new THREE.Vector3().copy(camera.value.position).sub(controls.value.target);
    const spherical = new THREE.Spherical().setFromVector3(currentOffset);
    
    // Default orientation (Front View)
    // 默认方向（前视图）
    // Relative to target (0,21,0), default pos was (0,20,70) -> offset (0, -1, 70)
    // We want to reset rotation to this direction, but keep current RADIUS (zoom).
    const defaultOffset = new THREE.Vector3(0, -1, 70);
    const defaultSpherical = new THREE.Spherical().setFromVector3(defaultOffset);
    
    // Lerp Angles (Theta/Phi) but keep Radius
    // 插值角度 (Theta/Phi) 但保持半径
    // Handle Theta wrapping for shortest path
    // 处理 Theta 环绕以获得最短路径
    let diff = defaultSpherical.theta - spherical.theta;
    if (diff > Math.PI) diff -= 2 * Math.PI;
    else if (diff < -Math.PI) diff += 2 * Math.PI;
    
    spherical.theta += diff * 0.05;
    spherical.phi += (defaultSpherical.phi - spherical.phi) * 0.05;
    
    // Set back to camera position
    // 设置回相机位置
    // Note: radius in 'spherical' is already the current radius, untouched.
    const newOffset = new THREE.Vector3().setFromSpherical(spherical);
    camera.value.position.copy(controls.value.target).add(newOffset);
    
    // Also reset target to center if it drifted
    // 如果目标漂移，也重置目标到中心
    const defaultTarget = new THREE.Vector3(0, 21, 0);
    controls.value.target.lerp(defaultTarget, 0.05);
  }

  // Calculate Target Head Rotation based on Camera Position + Mouse Input
  // 根据相机位置 + 鼠标输入计算目标头部旋转
  if (camera.value && scene.value) {
    // Check Raycast for Hover
    // 检查射线检测以进行悬停
    if (characterModel) {
      raycaster.setFromCamera(mouseNDC, camera.value);
      // Recursive check against character model
      // 针对角色模型的递归检查
      const intersects = raycaster.intersectObject(characterModel, true);
      const wasHovering = isHovering;
      isHovering = intersects.length > 0;
      
      if (isHovering && !wasHovering) {
        emit('hover-start');
      } else if (!isHovering && wasHovering) {
        emit('hover-end');
      }
    }

    // --- Head Tracking Logic ---
    // --- 头部追踪逻辑 ---
    const headBone = scene.value.getObjectByName('Head');
    // Default head position if bone not found (approximate height)
    // 如果未找到骨骼，则使用默认头部位置（近似高度）
    const headPos = headBone ? headBone.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 24, 0);
    const camPos = camera.value.position;
    
    // Vector from Head to Camera
    // 从头部到相机的向量
    const dx = camPos.x - headPos.x;
    const dy = camPos.y - headPos.y;
    const dz = camPos.z - headPos.z;
    
    // Calculate Yaw (Y-axis rotation)
    // 计算偏航角 (Y 轴旋转)
    let camYaw = Math.atan2(dx, dz) * (180 / Math.PI);
    
    // Calculate Pitch (X-axis rotation)
    // 计算俯仰角 (X 轴旋转)
    const hDist = Math.sqrt(dx*dx + dz*dz);
    let camPitch = -Math.atan2(dy, hDist) * (180 / Math.PI);
    
    // Add Mouse Offset
    // 添加鼠标偏移
    const maxMouseAngle = 15; 
    const maxHeadAngle = 45;  
    
    // Apply Hover Logic: If hovering, cancel mouse influence
    // 应用悬停逻辑：如果悬停，取消鼠标影响
    const effectiveMouseX = isHovering ? 0 : mouseInputX;
    const effectiveMouseY = isHovering ? 0 : mouseInputY;
    
    // Combine Camera Angle and Mouse Offset
    // 结合相机角度和鼠标偏移
    let totalYaw = -camYaw + (effectiveMouseX * maxMouseAngle * -1); 
    let totalPitch = camPitch + (effectiveMouseY * maxMouseAngle);
    
    // Clamp to max limits
    // 限制到最大限制
    targetHeadY = Math.max(-maxHeadAngle, Math.min(maxHeadAngle, totalYaw));
    targetHeadX = Math.max(-maxHeadAngle, Math.min(maxHeadAngle, totalPitch));
  }

  // Update Head Tracking (Lerp)
  // 更新头部追踪 (插值)
  // Smoothly interpolate current towards target
  // 平滑地将当前值插值向目标值
  const lerpFactor = 0.1; 
  currentHeadX += (targetHeadX - currentHeadX) * lerpFactor;
  currentHeadY += (targetHeadY - currentHeadY) * lerpFactor;
  
  molangContext.query.head_x_rotation = currentHeadX;
  molangContext.query.head_y_rotation = currentHeadY;

  if (controls.value) controls.value.update();
  animManager.update();
  
  // Apply Procedural Animation Overrides (Post-Update)
  // 应用程序化动画覆盖 (更新后)
  if (scene.value) {
      const leftEyelid = scene.value.getObjectByName('LeftEyelid');
      const rightEyelid = scene.value.getObjectByName('RightEyelid');
      const eyeBrow = scene.value.getObjectByName('EyeBrow');
      
      // Target scale: 0.1 (Squint) when petting, 1.0 (Open) when not
      // If shy, use a partial squint (e.g. 0.8) for a "shy/embarrassed" look
      // 目标缩放：抚摸时 0.1 (眯眼)，否则 1.0 (睁眼)
      // 如果害羞，使用部分眯眼 (例如 0.8) 表现“害羞/尴尬”的样子
      const targetSquint = isPetting ? 0.7 : (isShy.value ? 0.85 : 1.0);
      currentSquint += (targetSquint - currentSquint) * 0.2;
      
      if (leftEyelid) leftEyelid.scale.y = currentSquint;
      if (rightEyelid) rightEyelid.scale.y = currentSquint;

      // Eyebrow Animation (Pull down when petting)
      // 眉毛动画 (抚摸时下拉)
      if (eyeBrow) {
          // Petting priority over shy
          // 抚摸优先级高于害羞
          const targetOffset = isPetting ? -1.5 : (isShy.value ? 0.5 : 0);
          currentEyebrowOffset += (targetOffset - currentEyebrowOffset) * 0.2;
          
          // Use stored initial Y to avoid drifting
          // 使用存储的初始 Y 以避免漂移
          eyeBrow.position.y = initialEyebrowY + currentEyebrowOffset;
      }

      // Lip Sync (Jaw Flap)
      // 口型同步 (下巴开合)
      if (mouthBone) {
          // Smoothly interpolate current towards target
          // 平滑地将当前值插值向目标值
          currentLipSync.value += (lipSyncTarget.value - currentLipSync.value) * 0.3;
          
          // Map 0-1 to Rotation Angle (e.g., 0 to 30 degrees)
          // 映射 0-1 到旋转角度 (例如 0 到 30 度)
          const maxOpenAngle = THREE.MathUtils.degToRad(30); 
          mouthBone.rotation.x = currentLipSync.value * maxOpenAngle;
      }
  }
  
  if (renderer.value && scene.value && camera.value) {
    renderer.value.render(scene.value, camera.value);
  }
}

function onResize() {
  if (!container.value || !camera.value || !renderer.value) return;
  
  const width = container.value.clientWidth;
  const height = container.value.clientHeight;
  
  camera.value.aspect = width / height;
  camera.value.updateProjectionMatrix();
  renderer.value.setSize(width, height);
}

function onMouseMove(event: MouseEvent) {
  if (!container.value) return;

  const rect = container.value.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // Calculate mouse position relative to center (-1 to 1)
  // 计算相对于中心的鼠标位置 (-1 到 1)
  // Clamp to avoid extreme values when mouse is outside window
  // 当鼠标在窗口外时，限制以避免极值
  const rawX = (event.clientX - centerX) / (rect.width / 2);
  const rawY = (event.clientY - centerY) / (rect.height / 2);
  
  const x = Math.max(-1, Math.min(1, rawX));
  const y = Math.max(-1, Math.min(1, rawY));

  // Update global mouse input for animate loop
  // 更新动画循环的全局鼠标输入
  mouseInputX = x;
  mouseInputY = y;
  
  // Update Raycaster NDC (Y is inverted relative to screen coords for Raycaster)
  // 更新 Raycaster NDC (Y 相对于 Raycaster 的屏幕坐标是反转的)
  // rawX is -1(Left) to 1(Right) -> Matches NDC X
  // rawX 是 -1(左) 到 1(右) -> 匹配 NDC X
  // rawY is -1(Top) to 1(Bottom) -> NDC Y needs 1(Top) to -1(Bottom) => -rawY
  // rawY 是 -1(上) 到 1(下) -> NDC Y 需要 1(上) 到 -1(下) => -rawY
  mouseNDC.set(x, -y);
}

// Global mouse input storage
// 全局鼠标输入存储
let mouseInputX = 0;
let mouseInputY = 0;
let isLeftMouseDown = false;

function onMouseDown(event: MouseEvent) {
  if (event.button === 0) { // Left button // 左键
    isLeftMouseDown = true;

    // Check click intersection immediately for rapid response
    // 立即检查点击相交以获得快速响应
    if (camera.value && characterModel && container.value) {
       // Ensure raycaster is up-to-date with current mouse position from event
       // 确保 raycaster 使用来自事件的当前鼠标位置进行更新
       const rect = container.value.getBoundingClientRect();
       const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
       const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
       const clickNDC = new THREE.Vector2(x, y);

       raycaster.setFromCamera(clickNDC, camera.value);
       const intersects = raycaster.intersectObject(characterModel, true);
       
       if (intersects.length > 0) {
           const hit = intersects[0];
           // Traverse up to find the bone name
           // 向上遍历以查找骨骼名称
           let currentObj = hit.object;
           let partName = '';
           
           for (let i = 0; i < 5; i++) {
               if (!currentObj) break;
               if (currentObj.name && (
                   currentObj.name.includes('Head') || 
                   currentObj.name.includes('Body') || 
                   currentObj.name.includes('Arm') || 
                   currentObj.name.includes('Leg') ||
                   currentObj.name.includes('Chest') ||
                   currentObj.name.includes('Waist')
               )) {
                   partName = currentObj.name;
                   break;
               }
               if (currentObj.parent) {
                   currentObj = currentObj.parent;
               } else {
                   break;
               }
           }

           if (partName) {
               // Discrete click event, no state holding required for triggering
               // 离散点击事件，触发不需要状态保持
               isPetting = true; 
               let type = 'body';
               if (partName.includes('Head')) type = 'head';
               else if (partName.includes('Arm')) type = 'arm';
               else if (partName.includes('Leg')) type = 'leg';
               else if (partName.includes('Chest') || partName.includes('Waist') || partName.includes('Body')) type = 'body';
               
               emit('pet', { type: type, rawPart: partName });
           }
       }
    }
  }
}

function onMouseUp(event: MouseEvent) {
  if (event.button === 0) {
    isLeftMouseDown = false;
    isPetting = false; // Reset petting state on release // 释放时重置抚摸状态
  }
}

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

.debug-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(0, 0, 0, 0.5);
  padding: 10px;
  border-radius: 4px;
  z-index: 10;
}

.debug-controls select {
  padding: 5px;
  border-radius: 4px;
  background: white;
  color: #333;
  border: none;
  cursor: pointer;
  font-size: 14px;
}



.clothing-controls {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: white;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.3);
  padding: 5px;
  border-radius: 4px;
}

.clothing-controls label {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.loading-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-family: sans-serif;
  background: rgba(0,0,0,0.5);
  padding: 10px 20px;
  border-radius: 8px;
}

.error-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-family: sans-serif;
  background: rgba(255, 0, 0, 0.7);
  padding: 10px 20px;
  border-radius: 8px;
  max-width: 80%;
  word-wrap: break-word;
}
</style>

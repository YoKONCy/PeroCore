<script setup lang="ts">
/**
 * Pet3DView — 宠物互动页面 (F2-2)
 *
 * Canvas 2D 精灵图先行方案（Three.js/Live2D 后续升级）
 * 包含: 宠物渲染区 + 状态面板 + 动作按钮 + 对话气泡
 */
import { ref } from 'vue'
import { PixelIcon, PButton, PTooltip } from '../components/pixel'
import { usePetState } from '../composables/pet/usePetState'

defineOptions({ name: 'Pet3DView' })

const {
  stats, petName, lastInteraction,
  moodLabels, moodEmoji, actionLabels,
  affectionLevel,
  setAction, pat, feed,
} = usePetState()

const chatBubbleText = ref('主人好！今天也要加油哦~ ✨')
const isBubbleVisible = ref(true)

function triggerChat(text: string) {
  chatBubbleText.value = text
  isBubbleVisible.value = true
  setTimeout(() => { isBubbleVisible.value = false }, 4000)
}

function handlePat() {
  pat()
  triggerChat('嘿嘿，摸摸好舒服喵~ ☺️')
}

function handleFeed() {
  feed()
  triggerChat('谢谢主人！能量充满了！✨')
}

function handleDance() {
  setAction('dance')
  triggerChat('来跳个舞吧！💃')
  setTimeout(() => setAction('idle'), 3000)
}

function handleThink() {
  setAction('think')
  triggerChat('让我想想... 🤔')
  setTimeout(() => setAction('idle'), 3000)
}
</script>

<template>
  <div class="pet-view">
    <!-- 左侧: 宠物渲染区 -->
    <div class="pet-canvas-area">
      <!-- 背景粒子 -->
      <div class="pet-bg-particles">
        <span v-for="i in 12" :key="i" :class="['particle', `p-${i}`]" />
      </div>

      <!-- 宠物精灵 (Canvas 2D 占位，用 CSS 绘制像素角色) -->
      <div :class="['pet-sprite', `pet-action-${stats.currentAction}`]" @click="handlePat">
        <div class="pet-body">
          <div class="pet-head">
            <div class="pet-ear pet-ear-l" />
            <div class="pet-ear pet-ear-r" />
            <div class="pet-face">
              <div class="pet-eye pet-eye-l" />
              <div class="pet-eye pet-eye-r" />
              <div class="pet-mouth" />
            </div>
          </div>
          <div class="pet-torso" />
        </div>
        <!-- 心情指示 -->
        <div class="pet-mood-float">{{ moodEmoji[stats.mood] }}</div>
      </div>

      <!-- 对话气泡 -->
      <Transition name="bubble">
        <div v-if="isBubbleVisible" class="pet-bubble">
          <p>{{ chatBubbleText }}</p>
          <div class="pet-bubble-tail" />
        </div>
      </Transition>

      <!-- 点击提示 -->
      <p class="pet-click-hint">点击宠物可以摸头~</p>
    </div>

    <!-- 右侧: 控制面板 -->
    <div class="pet-panel">
      <!-- 宠物名称 -->
      <div class="pet-panel-header">
        <h2 class="pet-name">{{ petName }}</h2>
        <span class="pet-action-label">{{ actionLabels[stats.currentAction] }}</span>
      </div>

      <!-- 状态条 -->
      <div class="pet-stats">
        <div class="pet-stat">
          <div class="pet-stat-header">
            <span class="pet-stat-label">❤️ 好感度</span>
            <span class="pet-stat-value">{{ stats.affection }}% · {{ affectionLevel }}</span>
          </div>
          <div class="pet-stat-bar"><div class="pet-stat-fill stat-fill-pink" :style="{ width: stats.affection + '%' }" /></div>
        </div>
        <div class="pet-stat">
          <div class="pet-stat-header">
            <span class="pet-stat-label">⚡ 能量</span>
            <span class="pet-stat-value">{{ stats.energy }}%</span>
          </div>
          <div class="pet-stat-bar"><div class="pet-stat-fill stat-fill-yellow" :style="{ width: stats.energy + '%' }" /></div>
        </div>
        <div class="pet-stat">
          <div class="pet-stat-header">
            <span class="pet-stat-label">心情</span>
            <span class="pet-stat-value">{{ moodLabels[stats.mood] }}</span>
          </div>
        </div>
      </div>

      <!-- 动作按钮 -->
      <div class="pet-actions-section">
        <h3 class="pet-section-title">互动</h3>
        <div class="pet-actions-grid">
          <button class="pet-action-btn" @click="handlePat">
            <span class="pet-action-icon">✋</span>
            <span>摸头</span>
          </button>
          <button class="pet-action-btn" @click="handleFeed">
            <span class="pet-action-icon">🍰</span>
            <span>投喂</span>
          </button>
          <button class="pet-action-btn" @click="handleDance">
            <span class="pet-action-icon">💃</span>
            <span>跳舞</span>
          </button>
          <button class="pet-action-btn" @click="handleThink">
            <span class="pet-action-icon">💭</span>
            <span>思考</span>
          </button>
        </div>
      </div>

      <!-- 最近互动 -->
      <div class="pet-recent">
        <h3 class="pet-section-title">最近活动</h3>
        <p class="pet-recent-text">{{ lastInteraction }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pet-view { display: flex; width: 100%; height: 100%; overflow: hidden; }

/* 左侧画布 */
.pet-canvas-area {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  position: relative; background: var(--color-bg-primary); overflow: hidden;
}

/* 背景粒子 */
.pet-bg-particles { position: absolute; inset: 0; pointer-events: none; }
.particle {
  position: absolute; width: 4px; height: 4px;
  background: var(--color-blue-300); opacity: 0.3;
  animation: particle-float 6s ease-in-out infinite;
}
.p-1 { top: 10%; left: 20%; animation-delay: 0s; }
.p-2 { top: 30%; left: 70%; animation-delay: 1s; }
.p-3 { top: 60%; left: 15%; animation-delay: 2s; }
.p-4 { top: 80%; left: 50%; animation-delay: 0.5s; }
.p-5 { top: 20%; left: 85%; animation-delay: 1.5s; }
.p-6 { top: 50%; left: 40%; animation-delay: 3s; }
.p-7 { top: 70%; left: 80%; animation-delay: 2.5s; }
.p-8 { top: 40%; left: 30%; animation-delay: 4s; }
.p-9 { top: 90%; left: 60%; animation-delay: 1.8s; }
.p-10 { top: 15%; left: 55%; animation-delay: 3.5s; }
.p-11 { top: 75%; left: 25%; animation-delay: 0.8s; }
.p-12 { top: 45%; left: 90%; animation-delay: 2.2s; }

/* 宠物精灵 (纯 CSS 像素风) */
.pet-sprite {
  position: relative; cursor: pointer;
  transition: transform 0.3s;
  animation: float 3s ease-in-out infinite;
}
.pet-sprite:hover { transform: scale(1.05); }
.pet-sprite:active { transform: scale(0.95); }

.pet-body { display: flex; flex-direction: column; align-items: center; }
.pet-head { position: relative; width: 80px; height: 80px; background: var(--color-blue-400); display: flex; align-items: center; justify-content: center; }
.pet-ear { position: absolute; top: -16px; width: 20px; height: 24px; background: var(--color-blue-400); }
.pet-ear::after { content: ''; position: absolute; top: 4px; left: 4px; right: 4px; bottom: 4px; background: var(--color-pink-400, #f472b6); }
.pet-ear-l { left: 8px; }
.pet-ear-r { right: 8px; }
.pet-face { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.pet-eye { width: 10px; height: 10px; background: white; position: absolute; top: 28px; }
.pet-eye-l { left: 20px; }
.pet-eye-r { right: 20px; }
.pet-mouth { width: 12px; height: 6px; border-bottom: 3px solid white; position: absolute; bottom: 18px; }
.pet-torso { width: 60px; height: 48px; background: var(--color-blue-500); margin-top: -2px; }

/* 动作动画 */
.pet-action-wave { animation: wave 0.8s ease-in-out infinite; }
.pet-action-dance { animation: dance 0.5s ease-in-out infinite; }
.pet-action-sleep { animation: sleep 2s ease-in-out infinite; opacity: 0.7; }
.pet-action-think { animation: float 2s ease-in-out infinite; }

.pet-mood-float {
  position: absolute; top: -20px; right: -10px;
  font-size: 20px; animation: float 2s ease-in-out infinite;
}

/* 对话气泡 */
.pet-bubble {
  position: absolute; top: 15%; left: 50%; transform: translateX(-30%);
  background: var(--color-bg-primary); border: 2px solid var(--color-border);
  padding: 12px 16px; max-width: 240px;
  font-size: 13px; font-weight: 700; color: var(--color-text-primary); line-height: 1.5;
  box-shadow: 4px 4px 0 rgba(0,0,0,0.08);
}
.pet-bubble-tail {
  position: absolute; bottom: -10px; left: 20px;
  width: 12px; height: 12px; background: var(--color-bg-primary);
  border-right: 2px solid var(--color-border); border-bottom: 2px solid var(--color-border);
  transform: rotate(45deg);
}

.pet-click-hint {
  position: absolute; bottom: 32px;
  font-size: 10px; color: var(--color-text-muted); font-weight: 700;
  opacity: 0.5; letter-spacing: 0.1em;
}

/* 右侧面板 */
.pet-panel {
  width: 300px; border-left: 2px solid var(--color-border);
  background: var(--color-bg-secondary); padding: 24px;
  display: flex; flex-direction: column; gap: 24px; overflow-y: auto;
}
.pet-panel::-webkit-scrollbar { width: 4px; }
.pet-panel::-webkit-scrollbar-thumb { background: var(--color-blue-200); }

.pet-panel-header { display: flex; align-items: baseline; gap: 8px; }
.pet-name { font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.pet-action-label { font-size: 11px; font-weight: 700; color: var(--color-text-muted); }

/* 状态条 */
.pet-stats { display: flex; flex-direction: column; gap: 12px; }
.pet-stat { display: flex; flex-direction: column; gap: 4px; }
.pet-stat-header { display: flex; justify-content: space-between; }
.pet-stat-label { font-size: 12px; font-weight: 700; color: var(--color-text-secondary); }
.pet-stat-value { font-size: 11px; font-weight: 700; color: var(--color-text-muted); }
.pet-stat-bar { height: 6px; background: var(--color-bg-primary); overflow: hidden; }
.pet-stat-fill { height: 100%; transition: width 0.5s ease; }
.stat-fill-pink { background: var(--color-pink-500, #ec4899); }
.stat-fill-yellow { background: var(--color-yellow-500, #eab308); }

/* 动作按钮 */
.pet-section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-bottom: 8px; }
.pet-actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pet-action-btn {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px; border: 2px solid var(--color-border); background: var(--color-bg-primary);
  cursor: pointer; font-weight: 700; font-size: 11px; color: var(--color-text-secondary);
  transition: all 0.2s;
}
.pet-action-btn:hover { border-color: var(--color-blue-300); transform: translateY(-2px); color: var(--color-blue-500); }
.pet-action-btn:active { transform: scale(0.95); }
.pet-action-icon { font-size: 20px; }

/* 最近互动 */
.pet-recent-text { font-size: 12px; color: var(--color-text-muted); line-height: 1.6; }

/* 动画 */
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes wave { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(8deg); } }
@keyframes dance { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
@keyframes sleep { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.98); } }
@keyframes particle-float {
  0%, 100% { transform: translateY(0) rotate(0); opacity: 0.2; }
  50% { transform: translateY(-20px) rotate(180deg); opacity: 0.5; }
}

.bubble-enter-active { transition: all 0.3s ease-out; }
.bubble-leave-active { transition: all 0.2s ease-in; }
.bubble-enter-from, .bubble-leave-to { opacity: 0; transform: translateX(-30%) translateY(8px); }
</style>

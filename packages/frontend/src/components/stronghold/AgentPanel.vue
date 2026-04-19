<script setup lang="ts">
/**
 * AgentPanel — 据点右侧栏
 *
 * 在线成员列表 + 据点全员 + 管家状态面板。
 *
 * @emits summon - 召唤智能体
 * @emits open-butler - 打开管家弹窗
 */
import { PixelIcon, PButton } from '../pixel'

export interface AgentStatus {
  name: string
  avatar?: string
  room_name: string
  room_id: number
}

export interface ButlerConfig {
  persona?: string
}

interface Props {
  currentRoomAgents: AgentStatus[]
  allAgents: AgentStatus[]
  butlerConfig: ButlerConfig | null
}

defineProps<Props>()

const emit = defineEmits<{
  summon: [name: string]
  'open-butler': []
}>()
</script>

<template>
  <aside class="ap-panel">
    <!-- 标题 + 呼叫管家 -->
    <div class="ap-header">
      <span class="ap-header-title">系统监控中心</span>
      <PButton variant="primary" size="sm" @click="emit('open-butler')">
        <PixelIcon name="bot" size="xs" />
        呼叫管家
      </PButton>
    </div>

    <!-- 成员列表 -->
    <div class="ap-body">
      <!-- 当前房间 -->
      <section class="ap-section">
        <div class="ap-section-header">
          <span>当前在线成员</span>
          <span class="ap-badge ap-badge-local">LOCAL</span>
        </div>
        <div v-if="currentRoomAgents.length > 0" class="ap-agents">
          <div v-for="agent in currentRoomAgents" :key="agent.name" class="ap-agent-card">
            <div class="ap-avatar">
              {{ agent.name[0]?.toUpperCase() }}
            </div>
            <div class="ap-agent-info">
              <span class="ap-agent-name">{{ agent.name }}</span>
              <span class="ap-agent-status">
                <span class="ap-online-dot" />
                在此房间中
              </span>
            </div>
          </div>
        </div>
        <div v-else class="ap-empty">目前没有探测到成员喵</div>
      </section>

      <!-- 全员 -->
      <section class="ap-section">
        <div class="ap-section-header">
          <span>据点成员名录</span>
          <span class="ap-badge ap-badge-remote">REMOTE</span>
        </div>
        <div class="ap-agents">
          <div
            v-for="agent in allAgents"
            :key="agent.name"
            class="ap-agent-row"
            @click="emit('summon', agent.name)"
          >
            <div class="ap-avatar-sm">{{ agent.name[0]?.toUpperCase() }}</div>
            <div class="ap-agent-info">
              <span class="ap-agent-name-sm">{{ agent.name }}</span>
              <span class="ap-agent-loc">{{ agent.room_name }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 管家状态 -->
    <div class="ap-butler">
      <div class="ap-butler-header">
        <PixelIcon name="bot" size="xs" />
        <span>Butler System</span>
      </div>
      <p class="ap-butler-desc">
        {{ butlerConfig?.persona || '据点管家系统已就绪，随时听候您的指令喵~' }}
      </p>
    </div>
  </aside>
</template>

<style scoped>
.ap-panel {
  width: 300px;
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  overflow: hidden;
}

.ap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 2px solid var(--color-border);
}
.ap-header-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.2em;
}

.ap-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.ap-body::-webkit-scrollbar { width: 4px; }
.ap-body::-webkit-scrollbar-thumb { background: var(--color-blue-200); }

.ap-section { margin-bottom: 24px; }
.ap-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.15em;
}
.ap-badge {
  padding: 2px 8px;
  font-size: 8px;
  font-weight: 700;
  color: white;
}
.ap-badge-local { background: var(--color-green-500); }
.ap-badge-remote { background: var(--color-blue-500); }

.ap-agents { display: flex; flex-direction: column; gap: 8px; }

.ap-agent-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  transition: all 0.2s;
}
.ap-agent-card:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.04); }

.ap-avatar {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-pink-500);
  color: white;
  font-weight: 800;
  font-size: 16px;
  flex-shrink: 0;
}
.ap-avatar-sm {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-text-muted);
  color: white;
  font-weight: 800;
  font-size: 12px;
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.2s;
}

.ap-agent-info { flex: 1; min-width: 0; }
.ap-agent-name {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
}
.ap-agent-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  font-weight: 700;
  color: var(--color-green-500);
  margin-top: 2px;
}
.ap-online-dot {
  width: 5px;
  height: 5px;
  background: var(--color-green-500);
  animation: pulse 2s infinite;
}

.ap-agent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.ap-agent-row:hover {
  background: var(--color-bg-secondary);
}
.ap-agent-row:hover .ap-avatar-sm { opacity: 1; }
.ap-agent-name-sm {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.ap-agent-loc {
  font-size: 9px;
  color: var(--color-text-muted);
}

.ap-empty {
  padding: 24px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  border: 2px dashed var(--color-border);
}

/* 管家 */
.ap-butler {
  padding: 16px;
  border-top: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
}
.ap-butler-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  margin-bottom: 8px;
}
.ap-butler-desc {
  font-size: 11px;
  color: var(--color-text-muted);
  font-style: italic;
  line-height: 1.5;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
</style>

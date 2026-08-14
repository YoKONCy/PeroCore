<script setup lang="ts">
defineOptions({ name: 'SocialTab' })
/**
 * SocialTab — Dashboard 社交适配器管理面板
 *
 * 可扩展的社交适配器管理中心，通过顶部卡片切换不同适配器。
 * 当前仅实现 NapCat (QQ) 适配器。
 *
 * 结构:
 * - 顶部: 适配器选择卡片 (NapCat / Discord / Telegram, 后两者预留)
 * - 中部: 选中适配器的配置 + 控制面板
 * - 底部: 终端日志 (复用 SocialAdapterTerminal)
 *
 * @module packages/frontend/src/components/dashboard/tabs/SocialTab
 */
import { ref, onMounted, watch, computed } from 'vue'
import { PixelIcon, PButton, PSwitch, PInputNumber, PDialog } from '../../pixel'
import { useDashboardContext } from '../../../composables/dashboard'
import { useAgentStore, useNotificationStore } from '../../../stores'
import { invoke, isElectron } from '../../../utils/ipcAdapter'
import {
  socialApi,
  type SocialContactImpression,
  type SocialClearScope,
  type SocialModeConfig,
} from '../../../api/modules/socialApi'
import { logger } from '../../../lib/logger'
import SocialAdapterTerminal from '../../terminal/SocialAdapterTerminal.vue'

const ctx = useDashboardContext()
const agentStore = useAgentStore()
const notification = useNotificationStore()
const contacts = ref<SocialContactImpression[]>([])
const dataScope = ref<SocialClearScope>('channel')
const dataChannelType = ref<'private' | 'group'>('private')
const dataTargetId = ref('')
const confirmAgentName = ref('')
const dataBusy = ref(false)
const selectedContactId = ref('')
const confirmDialogVisible = ref(false)
const modeSaving = ref(false)
const modeConfig = ref<SocialModeConfig>({
  proactiveGroupEnabled: true,
  minMessagesForReview: 3,
  nightSilenceEnabled: true,
  nightSilenceStart: 0,
  nightSilenceEnd: 8,
  strangerPolicy: 'allow',
  groupWhitelist: [],
  groupBlacklist: [],
  userBlacklist: [],
})
const groupWhitelistText = ref('')
const groupBlacklistText = ref('')
const userBlacklistText = ref('')
const selectedContact = computed(
  () => contacts.value.find((item) => item.userId === selectedContactId.value) ?? null,
)
const requiresStrongConfirmation = computed(() =>
  ['all_messages', 'long_memory', 'all_social_data'].includes(dataScope.value),
)

// ── 类型 ──

interface AdapterCard {
  id: string
  name: string
  platform: string
  icon: string
  description: string
  available: boolean
}

// ── 适配器列表 ──

const adapters: AdapterCard[] = [
  {
    id: 'napcat',
    name: 'NapCat',
    platform: 'qq',
    icon: 'chat',
    description: 'QQ 机器人 (OneBot v11)',
    available: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    platform: 'discord',
    icon: 'terminal',
    description: 'Discord Bot',
    available: false,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    platform: 'telegram',
    icon: 'flash',
    description: 'Telegram Bot',
    available: false,
  },
]

// ── 状态 ──

const selectedAdapter = ref('napcat')
const activeSection = ref<'overview' | 'mode' | 'contacts' | 'data'>('overview')
const sections = [
  { id: 'overview', label: '概览与账号', icon: 'desktop' },
  { id: 'mode', label: '社交模式', icon: 'chat' },
  { id: 'contacts', label: '联系人', icon: 'users' },
  { id: 'data', label: '数据管理', icon: 'alert' },
] as const
const napcatInstalled = ref(false)
const napcatRunning = ref(false)
const napcatChecking = ref(false)
const napcatInstalling = ref(false)
const adapterConnected = ref(false)

/** 是否为 Electron 环境 (进程管理仅 Electron 可用) */
const canManageProcess = isElectron()

// ── 主人 QQ 配置 ──

/** 主人 QQ 输入框绑定值 */
const ownerQqInput = ref('')
/** 配置加载中 */
const configLoading = ref(false)
/** 配置保存中 */
const configSaving = ref(false)
/** 配置已保存标记（用于显示成功提示） */
const configSaved = ref(false)

// ── 方法 ──

/** 检查 NapCat 安装状态 */
async function checkNapCat(): Promise<void> {
  napcatChecking.value = true
  try {
    const installed = await invoke('check-napcat')
    napcatInstalled.value = !!installed

    // 同时从后端 API 获取连接状态
    try {
      const res = await socialApi.getStatus()
      const qqAdapter = res.data?.adapters?.find((a) => a.platform === 'qq')
      adapterConnected.value = qqAdapter?.connected ?? false
    } catch {
      // API 不可用
    }
  } catch {
    napcatInstalled.value = false
  } finally {
    napcatChecking.value = false
  }
}

/** 安装 NapCat */
async function installNapCat(): Promise<void> {
  napcatInstalling.value = true
  try {
    const result = await invoke('install-napcat')
    if (result) {
      napcatInstalled.value = true
    }
  } catch (e) {
    logger.error('SocialTab', 'NapCat 安装失败', e)
  } finally {
    napcatInstalling.value = false
  }
}

/** 启动 NapCat */
async function startNapCat(): Promise<void> {
  try {
    await invoke('start-napcat')
    napcatRunning.value = true
  } catch (e) {
    logger.error('SocialTab', 'NapCat 启动失败', e)
  }
}

/** 停止 NapCat */
async function stopNapCat(): Promise<void> {
  try {
    await invoke('stop-napcat')
    napcatRunning.value = false
  } catch (e) {
    logger.error('SocialTab', 'NapCat 停止失败', e)
  }
}

// ── 主人 QQ 配置 ──

/**
 * 加载社交配置
 *
 * 从后端 /api/configs/social 读取配置，回填主人 QQ 输入框。
 * 后端配置结构见 SocialConfig 类型。
 */
async function loadSocialConfig(): Promise<void> {
  configLoading.value = true
  try {
    const cfg = await socialApi.getConfig()
    ownerQqInput.value = cfg.ownerQq ?? ''
  } catch (e) {
    logger.error('SocialTab', '加载社交配置失败', e)
  } finally {
    configLoading.value = false
  }
}

/**
 * 保存主人 QQ 配置
 *
 * 采用"读-改-写"策略：先读取现有完整配置，更新 ownerQq 字段后整体回写，
 * 避免覆盖 bindings 等其他字段。
 *
 * 注意：保存后需要重启社交应用才能让 adapter 更新 ownerQq 识别逻辑，
 * 因为 SocialAppRuntime 在 initialize 时读取配置。prompt 注入也会在下次
 * generateReply 时生效（每次 compile 都从 this.ownerQq 读取）。
 */
async function saveOwnerQq(): Promise<void> {
  configSaving.value = true
  configSaved.value = false
  try {
    // 读-改-写：保留其他字段
    const existing = await socialApi.getConfig()
    existing.ownerQq = ownerQqInput.value.trim() || undefined
    await socialApi.saveConfig(existing)
    configSaved.value = true
    notification.toast('主人 QQ 配置已保存', { type: 'success', title: '保存成功' })
    // 2 秒后清除成功提示
    setTimeout(() => {
      configSaved.value = false
    }, 2000)
  } catch (e) {
    logger.error('SocialTab', '保存主人QQ配置失败', e)
    notification.toast('主人 QQ 配置保存失败', { type: 'error', title: '保存失败' })
  } finally {
    configSaving.value = false
  }
}

async function loadModeConfig(): Promise<void> {
  try {
    const response = await socialApi.getModeConfig()
    if (response.data) modeConfig.value = response.data
    groupWhitelistText.value = modeConfig.value.groupWhitelist.join('\n')
    groupBlacklistText.value = modeConfig.value.groupBlacklist.join('\n')
    userBlacklistText.value = modeConfig.value.userBlacklist.join('\n')
  } catch (error) {
    logger.error('SocialTab', '加载社交模式配置失败', error)
  }
}

function parseIdList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,，]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

async function saveModeConfig(): Promise<void> {
  modeSaving.value = true
  try {
    modeConfig.value.groupWhitelist = parseIdList(groupWhitelistText.value)
    modeConfig.value.groupBlacklist = parseIdList(groupBlacklistText.value)
    modeConfig.value.userBlacklist = parseIdList(userBlacklistText.value)
    const response = await socialApi.saveModeConfig(modeConfig.value)
    if (response.data) modeConfig.value = response.data
    notification.toast('社交模式配置已保存并生效', { type: 'success', title: '保存成功' })
  } catch (error) {
    logger.error('SocialTab', '保存社交模式配置失败', error)
    notification.toast('社交模式配置保存失败', { type: 'error', title: '保存失败' })
  } finally {
    modeSaving.value = false
  }
}

function openClearDialog(scope: SocialClearScope, targetId = ''): void {
  dataScope.value = scope
  dataTargetId.value = targetId
  confirmAgentName.value = ''
  confirmDialogVisible.value = true
}

async function loadContacts(): Promise<void> {
  const agentId = ctx.activeAgentId.value
  if (!agentId) return
  try {
    const response = await socialApi.getContacts(agentId)
    contacts.value = response.data?.contacts ?? []
    if (
      !selectedContactId.value ||
      !contacts.value.some((item) => item.userId === selectedContactId.value)
    ) {
      selectedContactId.value = contacts.value[0]?.userId ?? ''
    }
  } catch (error) {
    logger.error('SocialTab', '加载联系人印象失败', error)
  }
}

async function clearSocialData(): Promise<void> {
  const agentId = ctx.activeAgentId.value
  if (!agentId) return
  dataBusy.value = true
  try {
    await socialApi.clearData({
      agentId,
      scope: dataScope.value,
      channelType: dataScope.value === 'channel' ? dataChannelType.value : undefined,
      channelId: dataScope.value === 'channel' ? dataTargetId.value.trim() : undefined,
      userId: dataScope.value === 'contact_impression' ? dataTargetId.value.trim() : undefined,
      confirmAgentName: confirmAgentName.value,
    })
    dataTargetId.value = ''
    confirmAgentName.value = ''
    confirmDialogVisible.value = false
    await loadContacts()
  } catch (error) {
    logger.error('SocialTab', '清理社交数据失败', error)
  } finally {
    dataBusy.value = false
  }
}

watch(() => ctx.activeAgentId.value, loadContacts)

// ── 初始化 ──

onMounted(async () => {
  // 并行加载适配器状态和社交配置
  const tasks: Promise<void>[] = []

  if (canManageProcess) {
    tasks.push(checkNapCat())
  } else {
    // Docker 模式：只检查 API 连接状态
    tasks.push(
      (async () => {
        try {
          const res = await socialApi.getStatus()
          const qqAdapter = res.data?.adapters?.find((a) => a.platform === 'qq')
          adapterConnected.value = qqAdapter?.connected ?? false
        } catch {
          // 静默
        }
      })(),
    )
  }

  // 加载主人 QQ 配置（Electron/Docker 通用）
  tasks.push(loadSocialConfig())
  tasks.push(loadModeConfig())
  tasks.push(loadContacts())
  if (!agentStore.agents.length) tasks.push(agentStore.fetchAgents())

  await Promise.all(tasks)
})
</script>

<template>
  <div class="social-panel">
    <!-- 顶部：适配器选择卡片 -->
    <div class="sp-header">
      <div class="sp-header-title">
        <PixelIcon name="chat" size="sm" class="sp-title-icon" />
        <span class="sp-title-text">社交适配器</span>
        <span class="sp-badge">SOCIAL</span>
      </div>
    </div>

    <nav class="sp-sections" aria-label="社交应用功能">
      <button
        v-for="section in sections"
        :key="section.id"
        :class="['sp-section', activeSection === section.id && 'sp-section-active']"
        @click="activeSection = section.id"
      >
        <PixelIcon :name="section.icon" size="xs" />
        {{ section.label }}
      </button>
    </nav>

    <template v-if="activeSection === 'overview'">
      <div class="sp-adapter-cards">
        <button
          v-for="adapter in adapters"
          :key="adapter.id"
          :class="[
            'sp-card',
            selectedAdapter === adapter.id && 'sp-card-active',
            !adapter.available && 'sp-card-disabled',
          ]"
          :disabled="!adapter.available"
          @click="adapter.available && (selectedAdapter = adapter.id)"
        >
          <div class="sp-card-icon"><PixelIcon :name="adapter.icon" size="sm" /></div>
          <div class="sp-card-info">
            <span class="sp-card-name">{{ adapter.name }}</span>
            <span class="sp-card-desc">{{ adapter.description }}</span>
          </div>
          <div v-if="adapter.available" class="sp-card-status">
            <span
              v-if="adapter.id === 'napcat'"
              :class="['sp-status-dot', adapterConnected ? 'sp-dot-on' : 'sp-dot-off']"
            />
          </div>
          <span v-else class="sp-card-tag">待实现</span>
        </button>
      </div>
      <!-- 主人 QQ 配置区（权限控制核心） -->
      <div class="sp-owner-config">
        <div class="sp-block-header">
          <PixelIcon name="user" size="xs" />
          <span>主人 QQ</span>
        </div>
        <div class="sp-owner-body">
          <div class="sp-owner-row">
            <input
              v-model="ownerQqInput"
              class="sp-owner-input"
              type="text"
              placeholder="输入主人的 QQ 号（用于权限识别）"
              :disabled="configLoading || configSaving"
            />
            <PButton
              size="sm"
              variant="primary"
              :disabled="configLoading || configSaving"
              @click="saveOwnerQq"
            >
              <PixelIcon name="save" size="xs" />
              {{ configSaving ? '保存中...' : configSaved ? '已保存' : '保存' }}
            </PButton>
          </div>
          <div class="sp-hint">
            配置后，Agent 能识别消息是否来自主人，并在 system prompt
            中注入权限规则。只有主人能执行敏感操作（删好友、改设置等）。
          </div>
        </div>
      </div>

      <!-- 中部：NapCat 配置面板 (仅 Electron) -->
      <div v-if="selectedAdapter === 'napcat' && canManageProcess" class="sp-config">
        <div class="sp-config-row">
          <!-- 安装状态 -->
          <div class="sp-config-block">
            <div class="sp-block-header">
              <PixelIcon name="download" size="xs" />
              <span>进程管理</span>
            </div>
            <div class="sp-block-body">
              <div class="sp-status-line">
                <span class="sp-label">安装状态</span>
                <span :class="['sp-value', napcatInstalled ? 'sp-ok' : 'sp-na']">
                  {{ napcatChecking ? '检查中...' : napcatInstalled ? '已安装' : '未安装' }}
                </span>
              </div>
              <div class="sp-status-line">
                <span class="sp-label">连接状态</span>
                <span :class="['sp-value', adapterConnected ? 'sp-ok' : 'sp-na']">
                  {{ adapterConnected ? '已连接' : '未连接' }}
                </span>
              </div>
              <div class="sp-actions">
                <PButton
                  v-if="!napcatInstalled"
                  size="sm"
                  :disabled="napcatInstalling || napcatChecking"
                  @click="installNapCat"
                >
                  <PixelIcon name="download" size="xs" />
                  {{ napcatInstalling ? '安装中...' : '一键安装' }}
                </PButton>
                <template v-else>
                  <PButton v-if="!napcatRunning" size="sm" variant="primary" @click="startNapCat">
                    <PixelIcon name="flash" size="xs" />
                    启动
                  </PButton>
                  <PButton v-else size="sm" variant="ghost" @click="stopNapCat">
                    <PixelIcon name="alert" size="xs" />
                    停止
                  </PButton>
                </template>
                <PButton size="sm" variant="ghost" :disabled="napcatChecking" @click="checkNapCat">
                  <PixelIcon name="refresh" size="xs" />
                </PButton>
              </div>
            </div>
          </div>

          <!-- 连接信息 -->
          <div class="sp-config-block">
            <div class="sp-block-header">
              <PixelIcon name="settings" size="xs" />
              <span>连接配置</span>
            </div>
            <div class="sp-block-body">
              <div class="sp-status-line">
                <span class="sp-label">WS 端点</span>
                <span class="sp-value sp-mono">ws://127.0.0.1:9120/api/social/ws</span>
              </div>
              <div class="sp-status-line">
                <span class="sp-label">协议</span>
                <span class="sp-value">OneBot v11 (反向 WS)</span>
              </div>
              <div class="sp-hint">请在 NapCat 配置中将反向 WS 地址设置为上述端点</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Docker 模式提示 -->
      <div v-if="selectedAdapter === 'napcat' && !canManageProcess" class="sp-config">
        <div class="sp-config-row">
          <div class="sp-config-block sp-full">
            <div class="sp-block-header">
              <PixelIcon name="terminal" size="xs" />
              <span>Docker 模式</span>
            </div>
            <div class="sp-block-body">
              <div class="sp-status-line">
                <span class="sp-label">WS 端点</span>
                <span class="sp-value sp-mono">ws://&lt;host&gt;:9120/api/social/ws</span>
              </div>
              <div class="sp-status-line">
                <span class="sp-label">连接状态</span>
                <span :class="['sp-value', adapterConnected ? 'sp-ok' : 'sp-na']">
                  {{ adapterConnected ? '已连接' : '等待外部 NapCat 连接...' }}
                </span>
              </div>
              <div class="sp-hint">
                Docker 模式下请在外部独立运行 NapCat，并配置反向 WS 连接到后端容器
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 适配器运行终端属于概览与账号 -->
      <div class="sp-terminal">
        <SocialAdapterTerminal />
      </div>
    </template>

    <div v-else-if="activeSection === 'mode'" class="sp-mode-grid">
      <section class="sp-config-block">
        <div class="sp-block-header">
          <PixelIcon name="clock" size="xs" />
          <span>夜间静音</span>
        </div>
        <div class="sp-mode-body">
          <div class="sp-setting-line">
            <div>
              <strong>安静时段</strong>
              <small>静音期间不主动审视群聊</small>
            </div>
            <PSwitch v-model="modeConfig.nightSilenceEnabled" />
          </div>
          <div class="sp-number-row">
            <PInputNumber
              v-model="modeConfig.nightSilenceStart"
              label="开始小时"
              :min="0"
              :max="23"
            />
            <PInputNumber
              v-model="modeConfig.nightSilenceEnd"
              label="结束小时"
              :min="0"
              :max="23"
            />
          </div>
        </div>
      </section>
      <section class="sp-config-block">
        <div class="sp-block-header">
          <PixelIcon name="chat" size="xs" />
          <span>群聊主动策略</span>
        </div>
        <div class="sp-mode-body">
          <div class="sp-setting-line">
            <div>
              <strong>允许主动参与</strong>
              <small>未被 @ 时也可审视活跃群聊</small>
            </div>
            <PSwitch v-model="modeConfig.proactiveGroupEnabled" />
          </div>
          <PInputNumber
            v-model="modeConfig.minMessagesForReview"
            label="最少审视消息数"
            :min="1"
            :max="20"
          />
        </div>
      </section>
      <section class="sp-config-block sp-mode-wide">
        <div class="sp-block-header">
          <PixelIcon name="users" size="xs" />
          <span>名单策略</span>
        </div>
        <div class="sp-mode-body">
          <div class="sp-setting-line">
            <div>
              <strong>陌生人私聊</strong>
              <small>忽略时仅主人私聊可进入处理链</small>
            </div>
            <select v-model="modeConfig.strangerPolicy" class="sp-pixel-select">
              <option value="allow">允许</option>
              <option value="ignore">忽略</option>
            </select>
          </div>
          <div class="sp-list-grid">
            <label>
              群白名单
              <textarea v-model="groupWhitelistText" placeholder="每行一个群号；留空表示不限制" />
            </label>
            <label>
              群黑名单
              <textarea v-model="groupBlacklistText" placeholder="每行一个群号" />
            </label>
            <label>
              用户黑名单
              <textarea v-model="userBlacklistText" placeholder="每行一个 QQ 号" />
            </label>
          </div>
        </div>
      </section>
      <div class="sp-mode-actions">
        <PButton size="sm" :loading="modeSaving" @click="saveModeConfig">
          <PixelIcon name="save" size="xs" />
          保存社交模式
        </PButton>
      </div>
    </div>
    <div v-else-if="activeSection === 'contacts'" class="sp-contact-master">
      <aside class="sp-contact-sidebar">
        <div class="sp-block-header">
          <PixelIcon name="users" size="xs" />
          <span>联系人 · {{ contacts.length }}</span>
        </div>
        <button
          v-for="contact in contacts"
          :key="contact.userId"
          :class="['sp-contact-row', selectedContactId === contact.userId && 'is-active']"
          @click="selectedContactId = contact.userId"
        >
          <span class="sp-contact-avatar">
            {{ (contact.displayName || contact.userId).slice(0, 1) }}
          </span>
          <span>
            <strong>{{ contact.displayName || contact.userId }}</strong>
            <small>{{ contact.userId }}</small>
          </span>
        </button>
        <div v-if="!contacts.length" class="sp-empty">还没有保存印象</div>
      </aside>
      <section class="sp-contact-detail">
        <template v-if="selectedContact">
          <div class="sp-contact-head">
            <div>
              <small>CONTACT MEMORY</small>
              <h3>{{ selectedContact.displayName || selectedContact.userId }}</h3>
              <span>{{ selectedContact.userId }}</span>
            </div>
            <button
              class="sp-soft-action sp-soft-danger"
              @click="openClearDialog('contact_impression', selectedContact.userId)"
            >
              <PixelIcon name="trash" size="xs" />
              清除印象
            </button>
          </div>
          <div v-if="selectedContact.identity" class="sp-impression-box">
            <span>身份信息</span>
            <p>{{ selectedContact.identity }}</p>
          </div>
          <div class="sp-impression-box">
            <span>当前印象</span>
            <p>{{ selectedContact.impression }}</p>
          </div>
          <dl class="sp-contact-meta">
            <div>
              <dt>更新时间</dt>
              <dd>{{ selectedContact.updatedAt }}</dd>
            </div>
            <div>
              <dt>来源频道</dt>
              <dd>{{ selectedContact.sourceChannelId || '未记录' }}</dd>
            </div>
          </dl>
        </template>
        <div v-else class="sp-empty sp-empty-detail">从左侧选择一位联系人吧</div>
      </section>
    </div>
    <div v-else class="sp-danger-zone">
      <header class="sp-danger-head">
        <div>
          <span>DATA MAINTENANCE</span>
          <h3>当前 Agent 的社交数据</h3>
          <p>每一类数据都有独立边界，不会在没有说明时连带清除。</p>
        </div>
        <PixelIcon name="alert" size="md" />
      </header>
      <div class="sp-danger-list">
        <article>
          <div>
            <strong>指定会话记录</strong>
            <span>删除某位用户的私聊，或某个群的全部聊天记录。</span>
          </div>
          <div class="sp-inline-target">
            <select v-model="dataChannelType" class="sp-pixel-select">
              <option value="private">私聊</option>
              <option value="group">群聊</option>
            </select>
            <input v-model="dataTargetId" class="sp-pixel-input" placeholder="QQ 用户或群号" />
            <button class="sp-soft-action" @click="openClearDialog('channel', dataTargetId)">
              选择清理
            </button>
          </div>
        </article>
        <article>
          <div>
            <strong>全部聊天记录</strong>
            <span>保留联系人印象和社交长记忆，只删除消息流水。</span>
          </div>
          <button class="sp-soft-action sp-soft-danger" @click="openClearDialog('all_messages')">
            清除消息
          </button>
        </article>
        <article>
          <div>
            <strong>全部社交长记忆</strong>
            <span>重置当前 Agent 的 social.tdb，不删除聊天记录。</span>
          </div>
          <button class="sp-soft-action sp-soft-danger" @click="openClearDialog('long_memory')">
            清空长记忆
          </button>
        </article>
        <article class="is-critical">
          <div>
            <strong>彻底清除社交数据</strong>
            <span>同时删除消息、联系人印象和社交长记忆。</span>
          </div>
          <button class="sp-soft-action sp-soft-danger" @click="openClearDialog('all_social_data')">
            彻底清除
          </button>
        </article>
      </div>
    </div>

    <PDialog
      v-model="confirmDialogVisible"
      title="确认清理社交数据"
      :message="
        requiresStrongConfirmation
          ? `此操作影响当前角色 ${agentStore.currentAgent?.name ?? ''}，请输入角色名后继续。`
          : '此操作不可撤销，请确认目标无误。'
      "
      :mode="requiresStrongConfirmation ? 'prompt' : 'confirm'"
      :placeholder="requiresStrongConfirmation ? (agentStore.currentAgent?.name ?? '') : ''"
      confirm-text="确认清理"
      confirm-variant="danger"
      @confirm="
        (value?: string) => {
          if (value !== undefined) confirmAgentName = value
          clearSocialData()
        }
      "
    />
  </div>
</template>

<style scoped>
/* ── 二级导航 ── */
.sp-sections {
  display: flex;
  gap: 3px;
  margin: 0 24px 14px;
  border-bottom: 2px solid var(--color-sky-100, #e0f2fe);
  flex-shrink: 0;
}

.sp-section {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 13px 10px;
  margin-bottom: -2px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted, #94a3b8);
  font-family: var(--ui-font-pixel), monospace;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.sp-section::before {
  content: '';
  width: 4px;
  height: 4px;
  background: var(--color-sky-200, #bae6fd);
}

.sp-section:hover {
  color: var(--color-sky-600, #0284c7);
  background: rgba(224, 242, 254, 0.42);
}
.sp-section-active {
  color: var(--color-sky-600, #0284c7);
  border-bottom-color: var(--color-sky-400, #38bdf8);
  background: linear-gradient(180deg, transparent, rgba(186, 230, 253, 0.24));
}
.sp-section-active::before {
  background: var(--color-sky-400, #38bdf8);
  box-shadow: 5px 0 0 var(--color-sky-200, #bae6fd);
}

.sp-mode-grid {
  margin: 0 24px 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  overflow: auto;
}
.sp-mode-wide,
.sp-mode-actions {
  grid-column: 1 / -1;
}
.sp-mode-body {
  padding: 14px;
  display: grid;
  gap: 16px;
}
.sp-setting-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.sp-setting-line > div {
  display: grid;
  gap: 3px;
}
.sp-setting-line strong {
  font-size: 12px;
  color: var(--text-primary, #1e293b);
}
.sp-setting-line small {
  font-size: 10px;
  color: var(--text-muted, #94a3b8);
}
.sp-number-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.sp-list-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.sp-list-grid label {
  display: grid;
  gap: 6px;
  font-size: 10px;
  font-weight: 800;
  color: var(--text-muted, #94a3b8);
}
.sp-list-grid textarea {
  min-height: 76px;
  resize: vertical;
  padding: 8px;
  border: 2px solid var(--color-sky-100, #e0f2fe);
  background: var(--color-sky-50, #f0f9ff);
  color: var(--text-primary, #1e293b);
  font:
    11px Consolas,
    monospace;
  outline: none;
}
.sp-list-grid textarea:focus {
  border-color: var(--color-sky-400, #38bdf8);
}
.sp-mode-actions {
  display: flex;
  justify-content: flex-end;
}
.sp-pixel-select,
.sp-pixel-input {
  height: 32px;
  padding: 0 9px;
  border: 2px solid var(--color-sky-100, #e0f2fe);
  background: white;
  color: var(--text-primary, #1e293b);
  font:
    11px var(--ui-font-pixel),
    monospace;
  outline: none;
}
.sp-pixel-select:focus,
.sp-pixel-input:focus {
  border-color: var(--color-sky-400, #38bdf8);
}

.sp-contact-master {
  margin: 0 24px 16px;
  min-height: 270px;
  display: grid;
  grid-template-columns: 250px 1fr;
  border: 2px solid var(--color-sky-100, #e0f2fe);
  background: white;
  overflow: hidden;
}
.sp-contact-sidebar {
  border-right: 2px solid var(--color-sky-100, #e0f2fe);
  overflow: auto;
}
.sp-contact-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--color-sky-100, #e0f2fe);
  background: white;
  text-align: left;
  cursor: pointer;
}
.sp-contact-row:hover,
.sp-contact-row.is-active {
  background: var(--color-sky-50, #f0f9ff);
}
.sp-contact-row.is-active {
  box-shadow: inset 3px 0 0 var(--color-sky-400, #38bdf8);
}
.sp-contact-avatar {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: var(--color-sky-100, #e0f2fe);
  color: var(--color-sky-600, #0284c7);
  border: 1px solid var(--color-sky-200, #bae6fd);
  font-weight: 800;
}
.sp-contact-row > span:last-child {
  display: grid;
  gap: 2px;
}
.sp-contact-row strong {
  font-size: 11px;
  color: var(--text-primary, #1e293b);
}
.sp-contact-row small {
  font:
    9px Consolas,
    monospace;
  color: var(--text-muted, #94a3b8);
}
.sp-contact-detail {
  padding: 20px;
}
.sp-contact-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.sp-contact-head small {
  color: var(--color-sky-500, #0ea5e9);
  font-size: 9px;
  letter-spacing: 0.12em;
}
.sp-contact-head h3 {
  margin: 5px 0 2px;
  font-size: 18px;
  color: var(--text-primary, #1e293b);
}
.sp-contact-head span {
  font:
    10px Consolas,
    monospace;
  color: var(--text-muted, #94a3b8);
}
.sp-impression-box {
  margin-top: 18px;
  padding: 14px;
  border-left: 3px solid var(--color-sky-300, #7dd3fc);
  background: var(--color-sky-50, #f0f9ff);
}
.sp-impression-box span {
  font-size: 9px;
  font-weight: 800;
  color: var(--color-sky-600, #0284c7);
}
.sp-impression-box p {
  margin: 7px 0 0;
  line-height: 1.7;
  font-size: 12px;
  color: var(--text-secondary, #475569);
}
.sp-contact-meta {
  margin-top: 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.sp-contact-meta div {
  padding: 10px;
  border: 1px solid var(--color-sky-100, #e0f2fe);
}
.sp-contact-meta dt {
  font-size: 9px;
  color: var(--text-muted, #94a3b8);
}
.sp-contact-meta dd {
  margin: 4px 0 0;
  font-size: 10px;
  color: var(--text-primary, #1e293b);
}
.sp-empty {
  padding: 28px;
  text-align: center;
  color: var(--text-muted, #94a3b8);
}
.sp-empty-detail {
  margin-top: 72px;
}

.sp-danger-zone {
  margin: 0 24px 16px;
  border: 2px solid #fee2e2;
  background: white;
  overflow: auto;
}
.sp-danger-head {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  color: #ef4444;
  background: #fff7f7;
  border-bottom: 1px solid #fee2e2;
}
.sp-danger-head span {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
}
.sp-danger-head h3 {
  margin: 4px 0;
  color: var(--text-primary, #1e293b);
  font-size: 15px;
}
.sp-danger-head p {
  margin: 0;
  color: var(--text-muted, #94a3b8);
  font-size: 10px;
}
.sp-danger-list article {
  min-height: 64px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #f1f5f9;
}
.sp-danger-list article.is-critical {
  background: #fffafa;
}
.sp-danger-list article > div:first-child {
  display: grid;
  gap: 4px;
}
.sp-danger-list strong {
  font-size: 11px;
  color: var(--text-primary, #1e293b);
}
.sp-danger-list span {
  font-size: 10px;
  color: var(--text-muted, #94a3b8);
}
.sp-inline-target {
  display: flex !important;
  grid-template: none !important;
  gap: 6px !important;
}
.sp-pixel-input {
  width: 155px;
}
.sp-soft-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--color-sky-200, #bae6fd);
  background: var(--color-sky-50, #f0f9ff);
  color: var(--color-sky-600, #0284c7);
  font:
    10px var(--ui-font-pixel),
    monospace;
  cursor: pointer;
}
.sp-soft-action:hover {
  border-color: var(--color-sky-400, #38bdf8);
}
.sp-soft-danger {
  color: #dc2626;
  border-color: #fecaca;
  background: #fff7f7;
}
.sp-soft-danger:hover {
  border-color: #f87171;
}

/* ── 根容器 ── */
.social-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(180deg, #f8fafc 0%, #f0f9ff 100%);
}

/* ── 头部 ── */
.sp-header {
  padding: 20px 24px 12px;
  flex-shrink: 0;
}

.sp-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.sp-title-icon {
  color: var(--color-sky-500, #0ea5e9);
}

.sp-title-text {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary, #1e293b);
  letter-spacing: 0.02em;
}

.sp-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  background: rgba(14, 165, 233, 0.1);
  color: var(--color-sky-500, #0ea5e9);
  border: 1px solid rgba(14, 165, 233, 0.2);
  letter-spacing: 0.1em;
}

/* ── 适配器卡片 ── */
.sp-adapter-cards {
  display: flex;
  gap: 10px;
}

.sp-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: white;
  border: 2px solid var(--color-sky-100, #e0f2fe);
  cursor: pointer;
  transition: all 0.2s;
  min-width: 180px;
  position: relative;
}

.sp-card:hover:not(.sp-card-disabled) {
  border-color: var(--color-sky-300, #7dd3fc);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.1);
}

.sp-card-active {
  border-color: var(--color-sky-400, #38bdf8) !important;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.15);
}

.sp-card-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sp-card-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-sky-50, #f0f9ff);
  border: 1px solid var(--color-sky-100, #e0f2fe);
  color: var(--color-sky-500, #0ea5e9);
  flex-shrink: 0;
}

.sp-card-active .sp-card-icon {
  background: var(--color-sky-400, #38bdf8);
  color: white;
  border-color: var(--color-sky-400, #38bdf8);
}

.sp-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sp-card-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-primary, #1e293b);
}

.sp-card-desc {
  font-size: 10px;
  color: var(--text-muted, #94a3b8);
}

.sp-card-status {
  margin-left: auto;
}

.sp-status-dot {
  display: block;
  width: 8px;
  height: 8px;
}

.sp-dot-on {
  background: var(--emerald-face, #34d399);
  animation: sp-pulse 2s ease-in-out infinite;
}

.sp-dot-off {
  background: var(--text-muted, #94a3b8);
}

.sp-card-tag {
  margin-left: auto;
  font-size: 9px;
  font-weight: 700;
  color: var(--text-muted, #94a3b8);
  background: var(--color-sky-50, #f0f9ff);
  padding: 1px 6px;
  border: 1px solid var(--color-sky-100, #e0f2fe);
}

/* ── 配置区 ── */
.sp-config {
  padding: 0 24px 12px;
  flex-shrink: 0;
}

/* ── 主人 QQ 配置区 ── */
.sp-owner-config {
  margin: 0 24px 12px;
  background: white;
  border: 2px solid var(--color-sky-100, #e0f2fe);
  overflow: hidden;
  flex-shrink: 0;
}

.sp-owner-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sp-owner-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.sp-owner-input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
  font-family: 'Consolas', 'Monaco', monospace;
  color: var(--text-primary, #1e293b);
  background: var(--color-sky-50, #f0f9ff);
  border: 1px solid var(--color-sky-200, #bae6fd);
  outline: none;
  transition: border-color 0.2s;
}

.sp-owner-input:focus {
  border-color: var(--color-sky-400, #38bdf8);
}

.sp-owner-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sp-config-row {
  display: flex;
  gap: 12px;
}

.sp-config-block {
  flex: 1;
  background: white;
  border: 2px solid var(--color-sky-100, #e0f2fe);
  overflow: hidden;
}

.sp-config-block.sp-full {
  flex: unset;
  width: 100%;
}

.sp-block-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-sky-50, #f0f9ff);
  border-bottom: 1px solid var(--color-sky-100, #e0f2fe);
  font-size: 11px;
  font-weight: 800;
  color: var(--text-primary, #1e293b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sp-block-header :deep(.pixel-icon) {
  color: var(--color-sky-500, #0ea5e9);
}

.sp-block-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sp-status-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}

.sp-label {
  color: var(--text-muted, #94a3b8);
  font-weight: 600;
}

.sp-value {
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.sp-value.sp-ok {
  color: var(--emerald-face, #34d399);
}

.sp-value.sp-na {
  color: var(--text-muted, #94a3b8);
}

.sp-value.sp-mono {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 10px;
  background: var(--color-sky-50, #f0f9ff);
  padding: 1px 6px;
  border: 1px solid var(--color-sky-100, #e0f2fe);
}

.sp-hint {
  font-size: 10px;
  color: var(--text-muted, #94a3b8);
  padding: 4px 0 0;
  border-top: 1px dashed var(--color-sky-100, #e0f2fe);
  margin-top: 2px;
}

.sp-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

/* ── 终端区 ── */
.sp-terminal {
  flex: 1;
  overflow: hidden;
  margin: 0 24px 16px;
  border: 2px solid var(--color-sky-100, #e0f2fe);
}

/* ── 统一主题与字体覆盖 ── */
.social-panel {
  --sp-surface: var(--ui-bg-surface);
  --sp-surface-soft: var(--ui-bg-surface-soft);
  --sp-hover: var(--ui-bg-hover);
  --sp-active: var(--ui-bg-active);
  --sp-border: var(--ui-border-default);
  --sp-border-soft: var(--ui-border-subtle);
  --sp-text: var(--ui-text-primary);
  --sp-text-secondary: var(--ui-text-secondary);
  --sp-text-muted: var(--ui-text-tertiary);
  --sp-accent: var(--ui-accent-sky);
  --sp-accent-soft: var(--ui-accent-sky-soft);
  --sp-danger: var(--ui-danger);
  --sp-danger-soft: var(--ui-danger-soft);
  --sp-canvas: var(--ui-bg-surface-soft);
  font-family: var(--ui-font-pixel), monospace;
  color: var(--sp-text);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--sp-accent) 4%, transparent), transparent 38%),
    var(--sp-canvas);
}

.social-panel button,
.social-panel input,
.social-panel select,
.social-panel textarea {
  font-family: inherit;
}

.sp-header {
  padding-bottom: 7px;
}
.sp-header-title {
  margin-bottom: 0;
}
.sp-sections {
  border-color: var(--sp-border);
}
.sp-section {
  color: var(--sp-text-muted);
}
.sp-section::before {
  background: var(--sp-border);
}
.sp-section:hover {
  color: var(--sp-accent);
  background: var(--sp-hover);
}
.sp-section-active {
  color: var(--sp-accent);
  border-bottom-color: var(--sp-accent);
  background: linear-gradient(180deg, transparent, var(--sp-accent-soft));
}
.sp-section-active::before {
  background: var(--sp-accent);
  box-shadow: 5px 0 0 color-mix(in srgb, var(--sp-accent) 38%, transparent);
}

.sp-adapter-cards {
  margin: 0 24px 12px;
}
.sp-card,
.sp-owner-config,
.sp-config-block,
.sp-contact-master,
.sp-danger-zone {
  background: var(--sp-surface);
  border-color: var(--sp-border);
}
.sp-card-active {
  border-color: var(--sp-accent) !important;
  background: linear-gradient(135deg, var(--sp-surface), var(--sp-accent-soft));
  box-shadow: 0 4px 14px color-mix(in srgb, var(--sp-accent) 14%, transparent);
}
.sp-card-icon,
.sp-card-tag,
.sp-block-header,
.sp-owner-input,
.sp-value.sp-mono,
.sp-impression-box {
  background: var(--sp-surface-soft);
  border-color: var(--sp-border-soft);
}
.sp-card-name,
.sp-title-text,
.sp-block-header,
.sp-value,
.sp-setting-line strong,
.sp-contact-row strong,
.sp-contact-head h3,
.sp-contact-meta dd,
.sp-danger-head h3,
.sp-danger-list strong {
  color: var(--sp-text);
}
.sp-card-desc,
.sp-label,
.sp-hint,
.sp-setting-line small,
.sp-contact-row small,
.sp-contact-head span,
.sp-contact-meta dt,
.sp-empty,
.sp-danger-head p,
.sp-danger-list span {
  color: var(--sp-text-muted);
}

.sp-owner-input,
.sp-pixel-input,
.sp-pixel-select,
.sp-list-grid textarea {
  color: var(--sp-text);
  background: var(--sp-surface-soft);
  border-color: var(--sp-border);
}
.sp-owner-input:focus,
.sp-pixel-input:focus,
.sp-pixel-select:focus,
.sp-list-grid textarea:focus {
  border-color: var(--sp-accent);
}
.sp-hint {
  border-color: var(--sp-border-soft);
}

.sp-mode-grid,
.sp-contact-master,
.sp-danger-zone {
  min-height: 0;
  flex: 1;
}
.sp-mode-grid {
  align-content: start;
}
.sp-mode-body {
  background: var(--sp-surface);
}
.sp-list-grid label {
  color: var(--sp-text-muted);
}
.sp-mode-actions {
  padding-bottom: 2px;
}

.sp-contact-sidebar {
  border-color: var(--sp-border);
  background: var(--sp-surface-soft);
}
.sp-contact-row {
  color: var(--sp-text);
  background: transparent;
  border-color: var(--sp-border-soft);
}
.sp-contact-row:hover,
.sp-contact-row.is-active {
  background: var(--sp-hover);
}
.sp-contact-row.is-active {
  box-shadow: inset 3px 0 0 var(--sp-accent);
}
.sp-contact-avatar {
  color: var(--sp-accent);
  background: var(--sp-accent-soft);
  border-color: color-mix(in srgb, var(--sp-accent) 35%, var(--sp-border));
}
.sp-contact-detail {
  background: var(--sp-surface);
}
.sp-impression-box {
  border-left-color: var(--sp-accent);
}
.sp-impression-box span {
  color: var(--sp-accent);
}
.sp-impression-box p {
  color: var(--sp-text-secondary);
}
.sp-contact-meta div {
  border-color: var(--sp-border-soft);
  background: var(--sp-surface-soft);
}

.sp-danger-zone {
  border-color: color-mix(in srgb, var(--sp-danger) 34%, var(--sp-border));
}
.sp-danger-head {
  color: var(--sp-danger);
  background: var(--sp-danger-soft);
  border-color: color-mix(in srgb, var(--sp-danger) 25%, var(--sp-border));
}
.sp-danger-list article {
  border-color: var(--sp-border-soft);
  background: var(--sp-surface);
}
.sp-danger-list article.is-critical {
  background: color-mix(in srgb, var(--sp-danger) 6%, var(--sp-surface));
}
.sp-soft-action {
  color: var(--sp-accent);
  border-color: color-mix(in srgb, var(--sp-accent) 35%, var(--sp-border));
  background: var(--sp-accent-soft);
}
.sp-soft-action:hover {
  border-color: var(--sp-accent);
  background: var(--sp-hover);
}
.sp-soft-danger {
  color: var(--sp-danger);
  border-color: color-mix(in srgb, var(--sp-danger) 36%, var(--sp-border));
  background: var(--sp-danger-soft);
}
.sp-soft-danger:hover {
  border-color: var(--sp-danger);
}
.sp-terminal {
  min-height: 180px;
  border-color: var(--sp-border);
  background: var(--sp-surface-soft);
}

@media (max-width: 900px) {
  .sp-mode-grid {
    grid-template-columns: 1fr;
  }
  .sp-mode-wide,
  .sp-mode-actions {
    grid-column: 1;
  }
  .sp-list-grid {
    grid-template-columns: 1fr;
  }
  .sp-contact-master {
    grid-template-columns: 210px 1fr;
  }
  .sp-danger-list article {
    align-items: flex-start;
    flex-direction: column;
  }
}

/* ── 动画 ── */
@keyframes sp-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
</style>

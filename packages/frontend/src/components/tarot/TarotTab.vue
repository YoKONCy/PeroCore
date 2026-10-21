<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  TAROT_DECK,
  TAROT_SUIT_LABELS,
  getTarotCard,
  tarotMeaning,
  type TarotCard as Card,
  type TarotDraw,
  type TarotReading,
  type TarotSuit,
} from '@infos/shared'
import { PixelIcon, PButton, PDialog } from '../pixel'
import AgentStateHover from '../agent/AgentStateHover.vue'
import TarotCard from './TarotCard.vue'
import { tarotApi } from '../../api/modules/tarotApi'
import { useAgentStore, useNotificationStore } from '../../stores'
import { usePetStateStore } from '../../stores/usePetStateStore'
import { getApiBaseUrl } from '../../api/transport'
import { useMainNav } from '../../composables/main/useMainNav'
import { useConversationNavigation } from '../../composables/chat/useConversationNavigation'
import { invoke, isElectron } from '../../utils/ipcAdapter'

defineOptions({ name: 'TarotTab' })
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const agents = useAgentStore(),
  notify = useNotificationStore()
const characterStates = usePetStateStore()
const agentId = ref(agents.activeAgentId)
const companion = computed(() => agents.agents.find((agent) => agent.id === agentId.value))
const availableAgents = computed(() => agents.agents.filter((agent) => agent.isEnabled))
const avatarUrl = computed(() =>
  companion.value?.avatarUrl ? `${getApiBaseUrl()}${companion.value.avatarUrl}` : '',
)
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const day = ref(''),
  question = ref(''),
  reading = ref<TarotReading | null>(null),
  dailyCard = ref<TarotDraw | null>(null)
const loading = ref(false),
  drawing = ref(false),
  error = ref(''),
  interpretingIds = ref(new Set<string>()),
  unavailableIds = ref(new Set<string>())
const history = ref<TarotReading[]>([]),
  historyOpen = ref(false),
  historyLoading = ref(false),
  historyError = ref('')
const modal = ref<'deck' | 'card' | null>(null),
  detail = ref<{ card: Card; reversed: boolean } | null>(null)
const deckQuery = ref(''),
  deckSuit = ref<TarotSuit | 'all'>('all'),
  chatOpening = ref(false)
const { setTab } = useMainNav(),
  navigation = useConversationNavigation()
let generation = 0,
  disposed = false,
  clockTimer: ReturnType<typeof setInterval> | undefined
const inFlight = new Map<string, Promise<void>>()
const isToday = computed(() => !reading.value || reading.value.day === day.value)
const interpreting = computed(() => !!reading.value && interpretingIds.value.has(reading.value.id))
const unavailable = computed(() => !!reading.value && unavailableIds.value.has(reading.value.id))
const visibleDeck = computed(() =>
  TAROT_DECK.filter(
    (card) =>
      (deckSuit.value === 'all' || card.suit === deckSuit.value) &&
      `${card.name} ${card.keywords}`.includes(deckQuery.value.trim()),
  ),
)
const companionInvitation = computed(() =>
  reading.value ? getTarotCard(reading.value.companionCard.cardId).invitation : '',
)
function localDay(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function refresh(): Promise<void> {
  const current = ++generation,
    selected = agentId.value
  loading.value = true
  error.value = ''
  reading.value = null
  dailyCard.value = null
  try {
    if (!selected) return
    const response = await tarotApi.today(selected, timeZone)
    if (disposed || current !== generation) return
    if (!response.data) throw new Error('没有收到今天的抽牌记录')
    if (day.value && day.value !== response.data.day && !response.data.userCard) question.value = ''
    day.value = response.data.day
    dailyCard.value = response.data.userCard
    reading.value = response.data.reading
    if (response.data.userCard) question.value = response.data.question
  } catch (cause) {
    if (!disposed && current === generation)
      error.value = cause instanceof Error ? cause.message : '今天的牌桌暂时无法打开'
  } finally {
    if (!disposed && current === generation) loading.value = false
  }
}

async function drawTogether(): Promise<void> {
  if (loading.value || drawing.value || !companion.value || error.value) return
  const selected = agentId.value,
    current = generation
  drawing.value = true
  try {
    const response = await tarotApi.draw(
      selected,
      timeZone,
      question.value.trim(),
      characterStates.threadFor(selected) || undefined,
    )
    if (!response.data) throw new Error('抽牌没有完成，请再试一次')
    if (disposed || current !== generation || selected !== agentId.value) return
    const saved = response.data
    reading.value = saved
    day.value = saved.day
    dailyCard.value = saved.userCard
    question.value = saved.question
    if (historyOpen.value) void loadHistory()
    if (!saved.interpretation) void interpret(saved)
  } catch (cause) {
    if (!disposed && current === generation)
      error.value = cause instanceof Error ? cause.message : '抽牌暂时失败，请再试一次'
  } finally {
    if (!disposed) drawing.value = false
  }
}

function interpret(target: TarotReading): Promise<void> {
  if (target.interpretation) return Promise.resolve()
  const pending = inFlight.get(target.id)
  if (pending) return pending
  interpretingIds.value.add(target.id)
  unavailableIds.value.delete(target.id)
  const request = (async () => {
    try {
      const response = await tarotApi.interpret(target.id)
      if (disposed) return
      if (!response.data) throw new Error('暂时没有收到回应')
      if (reading.value?.id === target.id) reading.value = response.data.reading
      const index = history.value.findIndex((item) => item.id === target.id)
      if (index >= 0) history.value[index] = response.data.reading
      if (response.data.unavailable) unavailableIds.value.add(target.id)
    } catch {
      if (!disposed) unavailableIds.value.add(target.id)
    } finally {
      if (!disposed) interpretingIds.value.delete(target.id)
    }
  })().finally(() => inFlight.delete(target.id))
  inFlight.set(target.id, request)
  return request
}

async function loadHistory(): Promise<void> {
  const selected = agentId.value
  historyLoading.value = true
  historyError.value = ''
  try {
    const response = await tarotApi.history(selected)
    if (!disposed && selected === agentId.value) history.value = response.data ?? []
  } catch {
    if (!disposed && selected === agentId.value) historyError.value = '回忆暂时无法读取，请重试'
  } finally {
    if (!disposed && selected === agentId.value) historyLoading.value = false
  }
}
function toggleHistory(event: Event): void {
  historyOpen.value = (event.target as HTMLDetailsElement).open
  if (historyOpen.value && agentId.value) void loadHistory()
}
function selectHistory(item: TarotReading): void {
  reading.value = item
  unavailableIds.value.delete(item.id)
}
function openCard(draw: TarotDraw): void {
  detail.value = { card: getTarotCard(draw.cardId), reversed: draw.reversed }
  modal.value = 'card'
}
function closeModal(visible: boolean): void {
  if (!visible) modal.value = null
}

async function continueChat(): Promise<void> {
  const target = reading.value
  if (!target || chatOpening.value) return
  chatOpening.value = true
  try {
    await setTab('chat')
    if (isElectron()) await invoke('desktop-tabs:activate', 'home')
    const describe = (draw: TarotDraw) =>
      `${getTarotCard(draw.cardId).name}（${draw.reversed ? '逆位' : '正位'}）：${tarotMeaning(draw)}`
    navigation.value = {
      target: { agentId: target.agentId },
      revision: Date.now(),
      draft: [
        `我们在 ${target.day} 一起抽了塔罗牌，想接着和你聊聊。`,
        target.question
          ? `当时想聊的是：${target.question}`
          : '当时没有特定问题，只是想一起待一会儿。',
        `我的牌是${describe(target.userCard)}`,
        `你的回应牌是${describe(target.companionCard)}`,
        target.interpretation ? `你当时说：\n${target.interpretation}` : '',
        '你愿意陪我从这里继续聊吗？',
      ]
        .filter(Boolean)
        .join('\n\n'),
    }
    notify.toast(__t('ui.tarot', '抽牌结果已放入输入框'), 'success')
  } catch (cause) {
    notify.toast(
      cause instanceof Error ? cause.message : __t('ui.tarot', '暂时无法打开聊天'),
      'error',
    )
  } finally {
    chatOpening.value = false
  }
}

watch(
  () => agents.activeAgentId,
  (value) => {
    agentId.value = value
  },
)
watch(agentId, () => {
  history.value = []
  historyOpen.value = false
  question.value = ''
  void refresh()
})
watch(
  () => props.active,
  (active) => {
    if (!active) modal.value = null
    if (active && (!day.value || day.value !== localDay())) void refresh()
  },
)
function onVisibilityChange(): void {
  if (!document.hidden && props.active && day.value !== localDay()) void refresh()
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && modal.value && props.active) {
    event.preventDefault()
    modal.value = null
  }
}
onMounted(async () => {
  if (!agents.agents.length) await agents.fetchAgents()
  if (disposed) return
  if (!availableAgents.value.some((agent) => agent.id === agentId.value))
    agentId.value = availableAgents.value[0]?.id ?? ''
  day.value = localDay()
  await refresh()
  if (disposed) return
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('keydown', onKeydown)
  clockTimer = setInterval(() => {
    if (props.active && !document.hidden && day.value !== localDay()) void refresh()
  }, 30_000)
})
onBeforeUnmount(() => {
  disposed = true
  generation++
  clearInterval(clockTimer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="tarot-page" :aria-label="__t('ui.tarot', '和角色一起抽牌')">
    <div class="tarot-content">
      <header class="tarot-header">
        <div>
          <div class="tarot-eyebrow">
            <PixelIcon name="sparkle" size="sm" />
            {{ __t('ui.tarot', '与你共享的片刻') }}
          </div>
          <h1>{{ __t('ui.tarot', '一起抽牌') }}</h1>
          <p>{{ __t('ui.tarot', '你一张，我一张。让一个小小的巧合，成为今天的话题。') }}</p>
        </div>
        <PButton variant="ghost" size="sm" @click="modal = 'deck'">
          <PixelIcon name="book" size="sm" />
          {{ __t('ui.tarot', '完整牌组') }}
          <span class="tarot-count">78</span>
        </PButton>
      </header>

      <div class="tarot-companion-row">
        <AgentStateHover
          v-if="active"
          :agent-id="companion?.id"
          :agent-name="companion?.name"
          as="button"
          class="tarot-avatar"
          :aria-label="__t('ui.tarot', '查看角色的完整状态')"
        >
          <img v-if="avatarUrl" :src="avatarUrl" alt="" />
          <PixelIcon v-else name="cat" size="lg" />
        </AgentStateHover>
        <div>
          <label for="tarot-companion">{{ __t('ui.tarot', '今天和谁一起') }}</label>
          <select
            id="tarot-companion"
            v-model="agentId"
            :disabled="drawing || !availableAgents.length"
          >
            <option v-for="agent in availableAgents" :key="agent.id" :value="agent.id">
              {{ agent.name }}
            </option>
          </select>
        </div>
        <span class="tarot-day">
          {{ day || __t('ui.tarot', '今天') }}
          <small>{{ __t('ui.tarot', '同一天，同一份小巧合') }}</small>
        </span>
      </div>

      <div v-if="!availableAgents.length && !loading" class="tarot-notice" role="status">
        {{ __t('ui.tarot', '先启用一个角色，就能邀请它一起抽牌了。') }}
      </div>
      <div v-if="error" class="tarot-notice" role="alert">
        <span>{{ error }}</span>
        <PButton variant="ghost" size="sm" :loading="loading" @click="refresh">
          {{ __t('ui.tarot', '重试') }}
        </PButton>
      </div>
      <div v-if="loading" class="tarot-loading" role="status">
        <PixelIcon name="refresh" size="sm" animation="spin" />
        {{ __t('ui.tarot', '正在整理今天的牌桌…') }}
      </div>

      <template v-else-if="availableAgents.length && !error">
        <form v-if="!reading" class="tarot-question" @submit.prevent="drawTogether">
          <label for="tarot-question">
            {{ __t('ui.tarot', '有什么想聊的？') }}
            <span>{{ __t('ui.tarot', '也可以什么都不填') }}</span>
          </label>
          <input
            id="tarot-question"
            v-model="question"
            :disabled="drawing || !!dailyCard"
            maxlength="500"
            :placeholder="__t('ui.tarot', '比如：今天有一点没动力……')"
            autocomplete="off"
          />
          <p v-if="dailyCard">
            {{ __t('ui.tarot', '你的今日牌已经留下了，接下来让') }} {{ companion?.name }}
            {{ __t('ui.tarot', '抽一张回应牌。') }}
          </p>
          <div class="tarot-table tarot-table--waiting" aria-hidden="true">
            <TarotCard :draw="dailyCard" :label="__t('ui.tarot', '你的今日牌')" disabled />
            <span class="tarot-between"><PixelIcon name="sparkle" size="lg" /></span>
            <TarotCard :label="__t('ui.tarot', '角色的回应牌')" />
          </div>
          <PButton type="submit" :loading="drawing" :disabled="!companion">
            {{
              drawing
                ? __t('ui.tarot', '正在一起抽牌…')
                : dailyCard
                  ? __t('ui.tarot', '听听 {0} 的回应', [companion?.name])
                  : __t('ui.tarot', '和我一起翻牌')
            }}
            <PixelIcon name="chevron-right" size="sm" />
          </PButton>
          <small class="tarot-footnote">
            {{ __t('ui.tarot', '完整 78 张 · 随机正逆位 · 每日保存') }}
          </small>
        </form>

        <template v-else>
          <div class="tarot-reading-heading">
            <span>
              {{
                isToday
                  ? __t('ui.tarot', '今天的小巧合')
                  : __t('ui.tarot', '{0} 的共同回忆', [reading.day])
              }}
            </span>
            <PButton v-if="!isToday" variant="ghost" size="sm" @click="refresh">
              {{ __t('ui.tarot', '回到今天') }}
            </PButton>
            <small v-else>
              <PixelIcon name="check" size="xs" />
              {{ __t('ui.tarot', '已保存') }}
            </small>
          </div>
          <p v-if="reading.question" class="tarot-saved-question">“{{ reading.question }}”</p>
          <div :key="reading.id" class="tarot-table tarot-table--revealed">
            <div class="tarot-position">
              <span class="tarot-position-label">{{ __t('ui.tarot', '你的今日牌') }}</span>
              <TarotCard
                :draw="reading.userCard"
                :label="__t('ui.tarot', '你的今日牌')"
                @select="openCard(reading.userCard)"
              />
              <p>{{ tarotMeaning(reading.userCard) }}</p>
            </div>
            <span class="tarot-between" aria-hidden="true">
              <span />
              <PixelIcon name="sparkle" size="lg" />
              <span />
            </span>
            <div class="tarot-position">
              <span class="tarot-position-label">
                {{ reading.agentName }} {{ __t('ui.tarot', '的回应牌') }}
              </span>
              <TarotCard
                :draw="reading.companionCard"
                :label="__t('ui.tarot', '角色的回应牌')"
                @select="openCard(reading.companionCard)"
              />
              <p>{{ tarotMeaning(reading.companionCard) }}</p>
            </div>
          </div>
          <p class="tarot-tap-hint">{{ __t('ui.tarot', '点一下牌面，看看它还想说什么') }}</p>
          <article class="tarot-response" aria-live="polite" :aria-busy="interpreting">
            <div class="tarot-response-heading">
              <PixelIcon name="chat" size="sm" />
              <strong>{{ reading.agentName }} {{ __t('ui.tarot', '想对你说') }}</strong>
              <span v-if="reading.interpretation" class="tarot-saved-dot">
                {{ __t('ui.tarot', '已留下') }}
              </span>
            </div>
            <p v-if="reading.interpretation" class="tarot-response-text">
              {{ reading.interpretation }}
            </p>
            <div v-else-if="interpreting" class="tarot-response-pending">
              <PixelIcon name="refresh" size="sm" animation="spin" />
              {{ __t('ui.tarot', '正在想两张牌之间的小故事…') }}
            </div>
            <template v-else>
              <p class="tarot-response-placeholder">
                {{ __t('ui.tarot', '牌已经翻开了，让') }} {{ reading.agentName }}
                {{ __t('ui.tarot', '说说自己的想法吧。') }}
              </p>
              <PButton variant="secondary" size="sm" @click="interpret(reading)">
                {{
                  unavailable
                    ? __t('ui.tarot', '再听一次角色的回应')
                    : __t('ui.tarot', '听听角色的回应')
                }}
              </PButton>
              <small v-if="unavailable" class="tarot-retry-hint">
                {{ __t('ui.tarot', '回应失败，抽牌已保存，可稍后重试。') }}
              </small>
            </template>
            <div class="tarot-invitation">
              <PixelIcon name="heart" size="sm" />
              <span>
                <small>{{ __t('ui.tarot', '回应牌带来的小邀请') }}</small>
                {{ companionInvitation }}
              </span>
            </div>
          </article>
          <div class="tarot-actions">
            <PButton :loading="chatOpening" @click="continueChat">
              <PixelIcon name="chat" size="sm" />
              {{ __t('ui.tarot', '带着这次抽牌，继续聊聊') }}
            </PButton>
            <small>{{ __t('ui.tarot', '把两张牌和这段话一起带进对话') }}</small>
          </div>
        </template>
      </template>

      <details class="tarot-history" :open="historyOpen" @toggle="toggleHistory">
        <summary>
          <PixelIcon name="clock" size="sm" />
          {{ __t('ui.tarot', '和') }} {{ companion?.name || __t('ui.tarot', '角色') }}
          {{ __t('ui.tarot', '的抽牌回忆') }}
          <span>{{ __t('ui.tarot', '最近 30 次') }}</span>
        </summary>
        <div v-if="historyLoading" class="tarot-history-feedback">
          {{ __t('ui.tarot', '正在翻找回忆…') }}
        </div>
        <div v-else-if="historyError" class="tarot-history-feedback">
          {{ historyError }}
          <PButton variant="ghost" size="sm" @click="loadHistory">
            {{ __t('ui.tarot', '重试') }}
          </PButton>
        </div>
        <div v-else-if="!history.length" class="tarot-history-feedback">
          {{ __t('ui.tarot', '第一份回忆，会从今天开始。') }}
        </div>
        <div v-else class="tarot-history-list">
          <button
            v-for="item in history"
            :key="item.id"
            type="button"
            :class="{ 'is-selected': reading?.id === item.id }"
            @click="selectHistory(item)"
          >
            <time>{{ item.day }}</time>
            <span>
              {{ getTarotCard(item.userCard.cardId).name
              }}{{ item.userCard.reversed ? ' ↓' : ' ↑' }}
              <span class="tarot-history-cross">×</span>
              {{ getTarotCard(item.companionCard.cardId).name
              }}{{ item.companionCard.reversed ? ' ↓' : ' ↑' }}
            </span>
            <small>{{ item.question || __t('ui.tarot', '没有问题，也想一起待一会儿') }}</small>
            <PixelIcon name="chevron-right" size="xs" />
          </button>
        </div>
      </details>
      <footer class="tarot-page-footer">
        <PixelIcon name="sparkle" size="xs" />
        {{ __t('ui.tarot', '牌是聊天的起点，今天怎么过，还是由你决定。') }}
      </footer>
    </div>

    <PDialog
      :model-value="modal === 'deck'"
      :title="__t('ui.tarot', '完整牌组 · 78 张')"
      width="min(900px, calc(100vw - 32px))"
      @update:model-value="closeModal"
    >
      <div class="tarot-deck-controls">
        <input
          v-model="deckQuery"
          :aria-label="__t('ui.tarot', '搜索塔罗牌')"
          :placeholder="__t('ui.tarot', '搜索牌名或关键词…')"
        />
        <select v-model="deckSuit" :aria-label="__t('ui.tarot', '选择牌组')">
          <option value="all">{{ __t('ui.tarot', '全部 78 张') }}</option>
          <option v-for="(label, suit) in TAROT_SUIT_LABELS" :key="suit" :value="suit">
            {{ label }}
          </option>
        </select>
      </div>
      <div class="tarot-deck-grid">
        <TarotCard
          v-for="card in visibleDeck"
          :key="card.id"
          :draw="{ cardId: card.id, reversed: false }"
          compact
          @select="openCard({ cardId: card.id, reversed: false })"
        />
        <p v-if="!visibleDeck.length">{{ __t('ui.tarot', '没有找到这张牌，换个关键词试试。') }}</p>
      </div>
      <template #footer>
        <PButton variant="secondary" @click="modal = null">
          {{ __t('ui.tarot', '收好牌组') }}
        </PButton>
      </template>
    </PDialog>
    <PDialog
      :model-value="modal === 'card'"
      :title="detail?.card.name || __t('ui.tarot', '牌意')"
      width="min(540px, calc(100vw - 32px))"
      @update:model-value="closeModal"
    >
      <div v-if="detail" class="tarot-detail">
        <div class="tarot-detail-preview">
          <TarotCard
            :draw="{ cardId: detail.card.id, reversed: detail.reversed }"
            compact
            disabled
          />
        </div>
        <div>
          <span class="tarot-detail-keywords">{{ detail.card.keywords }}</span>
          <h3>{{ __t('ui.tarot', '正位') }}</h3>
          <p :class="{ 'tarot-detail-current': !detail.reversed }">{{ detail.card.upright }}</p>
          <h3>{{ __t('ui.tarot', '逆位') }}</h3>
          <p :class="{ 'tarot-detail-current': detail.reversed }">{{ detail.card.reversed }}</p>
          <h3>{{ __t('ui.tarot', '一个小邀请') }}</h3>
          <p>{{ detail.card.invitation }}。</p>
        </div>
      </div>
      <template #footer>
        <PButton variant="ghost" @click="modal = 'deck'">
          {{ __t('ui.tarot', '浏览全部牌') }}
        </PButton>
        <PButton variant="secondary" @click="modal = null">
          {{ __t('ui.tarot', '收好这张牌') }}
        </PButton>
      </template>
    </PDialog>
  </section>
</template>

<style scoped>
.tarot-page {
  position: relative;
  z-index: 1;
  --tarot-edge: color-mix(in srgb, var(--ui-accent-purple) 14%, var(--ui-border-default));
  --tarot-shade: color-mix(in srgb, var(--ui-text-primary) 7%, transparent);
  --tarot-side: color-mix(in srgb, var(--ui-border-strong) 45%, var(--ui-bg-canvas));
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 36px 28px 24px;
  background:
    radial-gradient(
      ellipse at 50% 20%,
      color-mix(in srgb, var(--ui-accent-purple) 5%, transparent),
      transparent 65%
    ),
    var(--ui-bg-canvas);
  color: var(--ui-text-primary);
}
.tarot-content {
  width: min(820px, 100%);
  margin-inline: auto;
}
.tarot-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 28px;
}
.tarot-eyebrow {
  display: flex;
  gap: 8px;
  align-items: center;
  font: 10px/1.6 var(--ui-font-pixel);
  color: var(--ui-accent-purple);
  letter-spacing: 1px;
}
.tarot-header h1 {
  margin: 10px 0;
  font: 28px/1.5 var(--ui-font-pixel);
}
.tarot-header p {
  margin: 0;
  color: var(--ui-text-secondary);
  font-size: 13px;
  line-height: 1.8;
}
.tarot-count {
  font-size: 10px;
  opacity: 0.6;
}
.tarot-companion-row {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 14px 18px;
  border: 1px solid var(--tarot-edge);
  background: color-mix(in srgb, var(--ui-bg-surface) 90%, transparent);
  backdrop-filter: blur(12px);
  box-shadow:
    inset 1px 1px color-mix(in srgb, white 16%, transparent),
    2px 2px 0 var(--tarot-side);
}
.tarot-avatar {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--tarot-edge);
  border-radius: 0;
  color: var(--ui-accent-purple);
  background: var(--ui-bg-canvas);
  cursor: pointer;
}
.tarot-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: pixelated;
}
.tarot-companion-row label {
  display: block;
  font-size: 10px;
  color: var(--ui-text-tertiary);
  margin-bottom: 4px;
}
.tarot-companion-row select {
  max-width: 240px;
  font: 14px var(--ui-font-pixel);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
  border: 0;
  padding: 2px 16px 2px 0;
  cursor: pointer;
}
.tarot-day {
  margin-left: auto;
  text-align: right;
  font: 12px/1.6 var(--ui-font-pixel);
  color: var(--ui-text-secondary);
}
.tarot-day small {
  display: block;
  font: 10px/1.8 var(--ui-font-body, sans-serif);
  color: var(--ui-text-tertiary);
}
.tarot-question {
  text-align: center;
  margin: 30px 0 0;
}
.tarot-question label {
  display: block;
  text-align: left;
  font-size: 13px;
  margin-bottom: 10px;
}
.tarot-question label span {
  margin-left: 12px;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.tarot-question input,
.tarot-deck-controls input,
.tarot-deck-controls select {
  width: 100%;
  padding: 12px 14px;
  font-size: 13px;
  color: var(--ui-text-primary);
  background: var(--ui-bg-surface);
  border: 1px solid var(--tarot-edge);
  border-radius: 0;
  box-shadow: inset 1px 1px var(--tarot-shade);
}
.tarot-question input:focus,
.tarot-deck-controls input:focus {
  outline: 1px solid var(--ui-accent-purple);
}
.tarot-question > p {
  margin: 14px 0 -10px;
  color: var(--ui-text-secondary);
  font-size: 12px;
  line-height: 1.8;
}
.tarot-table {
  display: grid;
  grid-template-columns: minmax(0, 230px) 56px minmax(0, 230px);
  justify-content: center;
  gap: 22px;
  margin: 28px 0 15px;
}
.tarot-table--waiting {
  opacity: 0.8;
  margin-block: 32px 28px;
}
.tarot-between {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 14px;
  color: color-mix(in srgb, var(--ui-accent-purple) 65%, transparent);
  padding-bottom: 85px;
}
.tarot-table--waiting .tarot-between {
  padding: 0;
}
.tarot-between > span {
  height: 34px;
  width: 1px;
  background: linear-gradient(transparent, var(--tarot-edge), transparent);
}
.tarot-footnote {
  display: block;
  color: var(--ui-text-tertiary);
  font-size: 10px;
  letter-spacing: 1px;
  margin-top: 15px;
}
.tarot-reading-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font: 14px var(--ui-font-pixel);
  margin-top: 28px;
}
.tarot-reading-heading small {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 11px var(--ui-font-body, sans-serif);
  color: var(--ui-text-tertiary);
}
.tarot-saved-question {
  text-align: center;
  overflow-wrap: anywhere;
  color: var(--ui-text-secondary);
  font-size: 13px;
  margin: 22px 0 -5px;
  white-space: pre-wrap;
}
.tarot-position {
  display: flex;
  align-items: center;
  flex-direction: column;
}
.tarot-position-label {
  font: 12px var(--ui-font-pixel);
  color: var(--ui-text-secondary);
  margin-bottom: 15px;
}
.tarot-position p {
  font-size: 12px;
  line-height: 1.85;
  text-align: center;
  color: var(--ui-text-secondary);
  margin: 20px 0 0;
}
.tarot-table--revealed .tarot-position {
  animation: tarot-reveal 440ms steps(8, end) both;
}
.tarot-table--revealed .tarot-position:last-child {
  animation-delay: 100ms;
}
@keyframes tarot-reveal {
  from {
    opacity: 0;
    transform: translateY(12px) rotateY(65deg);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.tarot-tap-hint {
  color: var(--ui-text-tertiary);
  text-align: center;
  font-size: 10px;
  margin: 18px 0 24px;
}
.tarot-response {
  border: 1px solid var(--tarot-edge);
  padding: 22px 24px;
  background: color-mix(in srgb, var(--ui-bg-surface) 94%, transparent);
  backdrop-filter: blur(12px);
  box-shadow:
    inset 1px 1px color-mix(in srgb, white 16%, transparent),
    3px 3px 0 var(--tarot-side);
}
.tarot-response-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-accent-purple);
}
.tarot-response-heading strong {
  font: 13px var(--ui-font-pixel);
}
.tarot-saved-dot {
  margin-left: auto;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.tarot-response-text {
  margin: 18px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 2;
  font-size: 13px;
}
.tarot-response-placeholder {
  font-size: 13px;
  line-height: 1.9;
  color: var(--ui-text-secondary);
  margin-block: 20px 15px;
}
.tarot-response-pending {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 80px;
  color: var(--ui-text-tertiary);
  font-size: 12px;
}
.tarot-invitation {
  display: flex;
  gap: 12px;
  align-items: center;
  border-top: 1px dashed var(--tarot-edge);
  padding-top: 16px;
  margin-top: 20px;
  color: var(--ui-accent-purple);
  font-size: 12px;
  line-height: 1.9;
}
.tarot-invitation small {
  display: block;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.tarot-retry-hint {
  display: block;
  font-size: 11px;
  line-height: 1.8;
  color: var(--ui-text-tertiary);
  margin-top: 12px;
}
.tarot-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: 28px 0;
}
.tarot-actions small {
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.tarot-notice,
.tarot-loading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  line-height: 1.8;
  padding: 20px 0;
  color: var(--ui-text-secondary);
}
.tarot-loading {
  justify-content: center;
  min-height: 240px;
}
.tarot-history {
  border-top: 1px solid var(--tarot-edge);
  margin-top: 36px;
}
.tarot-history summary {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--ui-text-secondary);
  padding: 18px 0;
  font-size: 12px;
  list-style: none;
}
.tarot-history summary::-webkit-details-marker {
  display: none;
}
.tarot-history summary span {
  margin-left: auto;
  font-size: 10px;
  color: var(--ui-text-tertiary);
}
.tarot-history-feedback {
  font-size: 12px;
  color: var(--ui-text-tertiary);
  padding-bottom: 18px;
}
.tarot-history-list {
  display: grid;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
  padding: 2px;
}
.tarot-history-list button {
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 6px 14px;
  padding: 12px 14px;
  background: var(--ui-bg-surface);
  border: 1px solid var(--tarot-edge);
  color: var(--ui-text-secondary);
  cursor: pointer;
  text-align: left;
  font-size: 12px;
  border-radius: 0;
}
.tarot-history-list button:hover,
.tarot-history-list button.is-selected {
  border-color: var(--ui-accent-purple);
}
.tarot-history-list time {
  font: 11px var(--ui-font-pixel);
  grid-row: span 2;
  align-self: center;
}
.tarot-history-list small {
  grid-column: 2;
  font-size: 10px;
  color: var(--ui-text-tertiary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tarot-history-list button > :last-child {
  grid-column: 3;
  grid-row: 1 / 3;
  align-self: center;
}
.tarot-history-cross {
  color: var(--ui-accent-purple);
  padding-inline: 5px;
}
.tarot-page-footer {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  color: var(--ui-text-tertiary);
  font-size: 10px;
  line-height: 1.8;
  padding-top: 24px;
}
.tarot-deck-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
}
.tarot-deck-controls input {
  flex: 1;
  min-width: 0;
}
.tarot-deck-controls select {
  width: 140px;
}
.tarot-deck-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  align-items: start;
  gap: 16px;
  max-height: 60vh;
  overflow: auto;
  padding: 5px 8px 10px 2px;
}
.tarot-detail {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 24px;
  color: var(--ui-text-primary);
}
.tarot-detail-keywords {
  font-size: 11px;
  color: var(--ui-accent-purple);
}
.tarot-detail h3 {
  font: 12px var(--ui-font-pixel);
  margin: 15px 0 7px;
}
.tarot-detail p {
  font-size: 12px;
  line-height: 1.9;
  color: var(--ui-text-secondary);
  margin: 0;
}
.tarot-detail .tarot-detail-current {
  color: var(--ui-accent-purple);
}
button:focus-visible,
select:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--ui-accent-purple);
  outline-offset: 3px;
}
@media (max-width: 620px) {
  .tarot-page {
    padding: 24px 16px;
  }
  .tarot-header {
    flex-direction: column;
    gap: 15px;
  }
  .tarot-header h1 {
    font-size: 24px;
  }
  .tarot-table {
    grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr);
    gap: 12px;
  }
  .tarot-companion-row {
    padding: 12px;
  }
  .tarot-companion-row select {
    max-width: 150px;
  }
  .tarot-day {
    font-size: 10px;
  }
  .tarot-day small {
    display: none;
  }
  .tarot-response {
    padding: 18px;
  }
  .tarot-detail {
    grid-template-columns: 100px 1fr;
    gap: 16px;
  }
  .tarot-history-list button {
    grid-template-columns: 74px 1fr auto;
    gap: 6px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tarot-table--revealed .tarot-position {
    animation: none;
  }
}
</style>

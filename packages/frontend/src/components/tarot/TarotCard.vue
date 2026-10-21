<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed } from 'vue'
import { getTarotCard, TAROT_SUIT_LABELS, type TarotDraw } from '@infos/shared'
import PixelIcon from '../pixel/PixelIcon.vue'

const props = withDefaults(
  defineProps<{ draw?: TarotDraw | null; label?: string; compact?: boolean; disabled?: boolean }>(),
  { draw: null, label: '', compact: false, disabled: false },
)
defineEmits<{ select: [] }>()
const card = computed(() => (props.draw ? getTarotCard(props.draw.cardId) : null))
const suitPaths = {
  wands:
    'M12 2v20 M12 7C6 7 5 4 5 4c5-1 7 3 7 3Z M12 13c6 0 7-4 7-4-5 0-7 4-7 4Z M12 18c-5 0-6-3-6-3 4-1 6 3 6 3Z',
  cups: 'M6 3h12v7a6 6 0 0 1-12 0V3Z M6 5H3v3c0 3 2 4 4 4 M18 5h3v3c0 3-2 4-4 4 M12 16v5 M7 21h10',
  swords: 'M12 2 9 6v9h6V6l-3-4Z M12 5v10 M5 15h14 M12 15v5 M10 22h4 M10 20h4',
  pentacles:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M12 5l2 5h5l-4 3 1.5 5-4.5-3-4.5 3L9 13l-4-3h5l2-5Z',
}
const numeral = computed(() => {
  if (!card.value) return ''
  if (card.value.suit !== 'major') return String(card.value.number)
  return [
    '0',
    'I',
    'II',
    'III',
    'IV',
    'V',
    'VI',
    'VII',
    'VIII',
    'IX',
    'X',
    'XI',
    'XII',
    'XIII',
    'XIV',
    'XV',
    'XVI',
    'XVII',
    'XVIII',
    'XIX',
    'XX',
    'XXI',
  ][card.value.number]
})
</script>

<template>
  <button
    type="button"
    class="tarot-card"
    :class="[
      { 'tarot-card--back': !card, 'tarot-card--compact': compact },
      `tarot-card--${card?.suit ?? 'major'}`,
    ]"
    :disabled="disabled || !card"
    :aria-label="
      card
        ? __t('ui.tarot', '{0} {1} {2}，查看牌意', [
            label,
            card.name,
            draw?.reversed ? '逆位' : '正位',
          ])
        : __t('ui.tarot', '{0} 等待抽牌', [label])
    "
    @click="$emit('select')"
  >
    <template v-if="card">
      <div class="tarot-card-top">
        <span>{{ numeral }}</span>
        <span>{{ TAROT_SUIT_LABELS[card.suit] }}</span>
      </div>
      <div
        class="tarot-card-art"
        :class="{ 'tarot-card-art--reversed': draw?.reversed }"
        aria-hidden="true"
      >
        <svg viewBox="0 0 120 150" class="tarot-card-orbit" fill="none" stroke="currentColor">
          <path d="M60 8 108 46v58L60 142 12 104V46Z M60 22 96 51v46l-36 31-36-31V51Z" />
          <path
            d="M60 0v16M60 134v16M0 75h18M102 75h18M26 24l8 10M86 116l8 10M94 24l-8 10M34 116l-8 10"
          />
          <path d="m60 26 3 6-3 6-3-6Z m0 86 3 6-3 6-3-6Z" fill="currentColor" stroke="none" />
        </svg>
        <PixelIcon
          v-if="card.suit === 'major'"
          :name="card.icon"
          :size="compact ? 'xl' : '3xl'"
          class="tarot-card-symbol"
        />
        <svg
          v-else
          class="tarot-suit-symbol"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        >
          <path :d="suitPaths[card.suit]" />
        </svg>
        <span v-if="card.suit !== 'major'" class="tarot-card-rank">
          {{ card.number > 10 ? card.name.slice(2) : card.number }}
        </span>
      </div>
      <strong>{{ card.name }}</strong>
      <small>
        {{
          compact
            ? draw?.reversed
              ? __t('ui.tarot', '逆位')
              : __t('ui.tarot', '正位')
            : card.keywords
        }}
      </small>
      <span v-if="!compact" class="tarot-card-orientation">
        {{
          draw?.reversed ? __t('ui.tarot', '逆位 · 换个角度') : __t('ui.tarot', '正位 · 顺着心意')
        }}
      </span>
    </template>
    <template v-else>
      <span class="tarot-card-back-frame" aria-hidden="true">
        <PixelIcon name="sparkle" size="3xl" />
        <span>infOS</span>
      </span>
      <small>{{ label || __t('ui.tarot', '等待一个小小的巧合') }}</small>
    </template>
  </button>
</template>

<style scoped>
.tarot-card {
  --card-accent: var(--ui-accent-purple);
  width: 100%;
  aspect-ratio: 0.67;
  min-width: 0;
  max-width: 230px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  position: relative;
  padding: 15px;
  border: 1px solid color-mix(in srgb, var(--card-accent) 45%, var(--ui-border-default));
  border-radius: 0;
  color: var(--ui-text-primary);
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--card-accent) 9%, var(--ui-bg-surface)),
    var(--ui-bg-surface)
  );
  box-shadow:
    inset 0 0 0 5px var(--ui-bg-surface),
    inset 0 0 0 6px color-mix(in srgb, var(--card-accent) 18%, transparent),
    4px 4px 0 color-mix(in srgb, var(--ui-border-strong) 45%, var(--ui-bg-canvas));
  cursor: pointer;
  transition:
    transform 160ms steps(4, end),
    border-color 160ms;
  text-align: center;
}
.tarot-card--wands {
  --card-accent: var(--ui-warning);
}
.tarot-card--cups {
  --card-accent: var(--ui-accent-primary);
}
.tarot-card--swords {
  --card-accent: var(--ui-accent-sky);
}
.tarot-card--pentacles {
  --card-accent: var(--ui-success);
}
.tarot-card:hover:not(:disabled) {
  transform: translateY(-4px);
  border-color: var(--card-accent);
}
.tarot-card:focus-visible {
  outline: 2px solid var(--card-accent);
  outline-offset: 5px;
}
.tarot-card-top {
  display: flex;
  justify-content: space-between;
  width: 100%;
  color: var(--card-accent);
  font: 10px var(--ui-font-pixel);
  gap: 4px;
}
.tarot-card-art {
  position: relative;
  display: grid;
  place-items: center;
  width: 85%;
  flex: 1;
  min-height: 0;
  color: var(--card-accent);
}
.tarot-card-art--reversed {
  transform: rotate(180deg);
}
.tarot-card-orbit {
  position: absolute;
  height: 90%;
  max-width: 100%;
  opacity: 0.35;
  stroke-width: 0.8;
}
.tarot-card-symbol {
  z-index: 1;
}
.tarot-suit-symbol {
  width: 48px;
  height: 48px;
  z-index: 1;
}
.tarot-card--compact .tarot-suit-symbol {
  width: 32px;
  height: 32px;
}
.tarot-card-rank {
  position: absolute;
  bottom: 13%;
  font: 12px var(--ui-font-pixel);
}
.tarot-card strong {
  margin-top: 5px;
  font: 18px/1.5 var(--ui-font-pixel);
}
.tarot-card small {
  color: var(--ui-text-secondary);
  font-size: 11px;
  line-height: 1.8;
}
.tarot-card-orientation {
  color: var(--card-accent);
  font-size: 10px;
  margin-top: 9px;
}
.tarot-card--back {
  cursor: default;
  background:
    repeating-linear-gradient(
      45deg,
      transparent 0 10px,
      color-mix(in srgb, var(--card-accent) 3%, transparent) 10px 11px
    ),
    var(--ui-bg-surface);
}
.tarot-card-back-frame {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  color: var(--card-accent);
}
.tarot-card-back-frame span {
  font: 13px var(--ui-font-pixel);
  letter-spacing: 5px;
}
.tarot-card--compact {
  padding: 12px;
  max-width: none;
}
.tarot-card--compact strong {
  font-size: 13px;
}
.tarot-card--compact .tarot-card-top {
  font-size: 8px;
}
.tarot-card--compact .tarot-card-rank {
  font-size: 9px;
}
@media (prefers-reduced-motion: reduce) {
  .tarot-card {
    transition: none;
  }
}
</style>

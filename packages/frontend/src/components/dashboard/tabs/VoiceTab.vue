<script setup lang="ts">
/**
 * VoiceTab — 语音功能 Tab
 *
 * TTS/STT 配置界面。
 * TODO: 接入 configApi
 */
import { PixelIcon } from '../../pixel'
</script>

<template>
  <div class="tab-voice">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="mic" size="md" /><span>语音功能</span></h2>
      <p class="tab-subtitle">VOICE CONFIGURATION</p>
    </div>
    <div class="tab-placeholder">
      <PixelIcon name="mic" size="xl" />
      <p>语音配置将在接入 configApi 后显示</p>
    </div>
  </div>
</template>

<style scoped>
.tab-voice { padding: 32px; }
.tab-header { margin-bottom: 24px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }
.tab-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 300px; color: var(--color-text-muted); font-weight: 700; }
</style>

<script setup lang="ts">
/**
 * UserSettingsTab — 用户设定 Tab
 *
 * 个人信息、偏好设置、记忆配置。
 * TODO: 接入 configApi + agentApi
 */
import { PixelIcon } from '../../pixel'
</script>

<template>
  <div class="tab-user">
    <div class="tab-header">
      <h2 class="tab-title"><PixelIcon name="user" size="md" /><span>用户设定</span></h2>
      <p class="tab-subtitle">USER SETTINGS</p>
    </div>
    <div class="tab-placeholder">
      <PixelIcon name="user" size="xl" />
      <p>用户设定将在接入 configApi 后显示</p>
    </div>
  </div>
</template>

<style scoped>
.tab-user { padding: 32px; }
.tab-header { margin-bottom: 24px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }
.tab-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; height: 300px; color: var(--color-text-muted); font-weight: 700; }
</style>

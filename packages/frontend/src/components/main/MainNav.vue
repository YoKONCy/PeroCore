<script setup lang="ts">
/**
 * MainNav — MainView 左侧主导航
 *
 * 极简品牌 + 像素光轨导航:
 * - 顶部: 品牌 Logo + 版本号(可点击收起)
 * - 中间: 三层分组导航(交互/工作台/设置/高级)
 * - 底部: 主题切换
 *
 * 设计语言: Arc 空间层级 + 像素萌系品牌细节
 * - 浅色: 柔和粉蓝渐变背景, 细边框, 低饱和阴影
 * - 深色: 深紫蓝夜空背景, 微发光边框, 霓虹点缀
 *
 * @see .docs/S06_UI_UX_DESIGN_SPEC.md §3.2, §11.4, §14
 */
import { PixelIcon } from '../pixel'
import { useMainNav, type MainNavItem } from '../../composables/main/useMainNav'
import { useApprovalStore } from '../../stores'
import logoImg from '../../assets/logo.png'

const {
  currentTab,
  pendingTab,
  isNavCollapsed,
  isNavPinned,
  navGroups,
  setTab,
  prefetchTab,
  toggleNavPin,
  toggleGroup,
  isGroupExpanded,
  theme,
  toggleTheme,
} = useMainNav()
const approvalStore = useApprovalStore()

// ── 导航项样式 ──

function itemClasses(item: MainNavItem): string[] {
  const isActive = currentTab.value === item.id
  const classes = ['main-nav-item']
  if (isActive) classes.push('main-nav-item--active')
  if (pendingTab.value === item.id) classes.push('main-nav-item--pending')
  if (item.disabled) classes.push('main-nav-item--disabled')
  return classes
}
</script>

<template>
  <aside class="main-nav" :class="{ 'main-nav--collapsed': isNavCollapsed }">
    <!-- 像素纹理背景层 -->
    <div class="main-nav-pixel-bg" />

    <!-- 品牌标识 + 固定按钮 -->
    <div class="main-nav-brand">
      <div class="main-nav-logo">
        <img :src="logoImg" alt="Logo" />
      </div>
      <div v-if="!isNavCollapsed" class="main-nav-brand-text">
        <span class="main-nav-brand-sub">PeroperoChat</span>
        <span class="main-nav-brand-name font-pixel">萌动链接</span>
      </div>
      <!-- 固定/收起切换 -->
      <button
        v-if="!isNavCollapsed"
        class="main-nav-pin"
        :class="{ 'main-nav-pin--pinned': isNavPinned }"
        :title="isNavPinned ? '取消固定' : '固定展开'"
        @click="toggleNavPin"
      >
        <PixelIcon :name="isNavPinned ? 'pin' : 'pin-off'" size="xs" />
      </button>
    </div>

    <!-- 收起态固定按钮 (单独一行) -->
    <div v-if="isNavCollapsed" class="main-nav-pin-row">
      <button
        class="main-nav-pin main-nav-pin--collapsed"
        :class="{ 'main-nav-pin--pinned': isNavPinned }"
        :title="isNavPinned ? '取消固定' : '固定展开'"
        @click="toggleNavPin"
      >
        <PixelIcon :name="isNavPinned ? 'pin' : 'pin-off'" size="xs" />
      </button>
    </div>

    <!-- 导航分组 -->
    <nav class="main-nav-list">
      <div v-for="group in navGroups" :key="group.id" class="main-nav-group">
        <!-- 分组标题 -->
        <button
          v-if="group.title"
          class="main-nav-group-title"
          :class="{ 'main-nav-group-title--expanded': isGroupExpanded(group.id) }"
          @click="group.collapsible && toggleGroup(group.id)"
        >
          <span v-if="!isNavCollapsed" class="main-nav-group-label">{{ group.title }}</span>
          <PixelIcon
            v-if="group.collapsible"
            :name="isGroupExpanded(group.id) ? 'chevron-up' : 'chevron-down'"
            size="xs"
            class="main-nav-group-chevron"
          />
        </button>

        <!-- 导航项 -->
        <template v-if="!group.collapsible || isGroupExpanded(group.id)">
          <button
            v-for="item in group.items"
            :key="item.id"
            :class="itemClasses(item)"
            :disabled="item.disabled"
            @pointerenter="prefetchTab(item.id)"
            @focus="prefetchTab(item.id)"
            @click="setTab(item.id)"
          >
            <!-- 像素光轨指示 -->
            <div v-if="currentTab === item.id" class="main-nav-item-trail" />

            <PixelIcon :name="item.icon" size="sm" class="main-nav-item-icon" />

            <span v-if="!isNavCollapsed" class="main-nav-item-label">
              {{ item.label }}
            </span>
            <!-- 全局审批角标：在任意 Tab 都可见，不归属于工作区。 -->
            <span
              v-if="approvalStore.pendingCount && item.id === 'chat'"
              class="main-nav-approval-badge"
              :class="{ 'main-nav-approval-badge--collapsed': isNavCollapsed }"
            >
              {{ approvalStore.pendingCount }}
            </span>

            <!-- 收起态 Tooltip -->
            <span v-if="isNavCollapsed" class="main-nav-tooltip">{{ item.label }}</span>
          </button>
        </template>
      </div>
    </nav>

    <!-- 底部区域 -->
    <div class="main-nav-footer">
      <button
        class="main-nav-theme-btn"
        :title="theme === 'light' ? '切换到深色' : '切换到浅色'"
        @click="toggleTheme"
      >
        <PixelIcon :name="theme === 'light' ? 'moon' : 'sun'" size="sm" />
        <span v-if="!isNavCollapsed" class="main-nav-item-label">
          {{ theme === 'light' ? '深色模式' : '浅色模式' }}
        </span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.main-nav-approval-badge {
  position: absolute;
  top: 4px;
  right: 7px;
  z-index: 2;
  display: grid;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  place-items: center;
  border: 2px solid var(--ui-bg-surface, #fff);
  border-radius: 9px;
  background: #f43f5e;
  color: white;
  font-size: 8px;
  font-weight: 800;
  line-height: 1;
  box-shadow: 0 2px 6px rgba(244, 63, 94, 0.32);
  pointer-events: none;
}

.main-nav-approval-badge--collapsed {
  top: 2px;
  right: 2px;
}

/* ═══════════════════════════════════════════════════════════════
 * 导航容器
 * ═══════════════════════════════════════════════════════════════ */

.main-nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  flex-shrink: 0;
  position: relative;
  z-index: 20;
  overflow: hidden;
  width: var(--ui-nav-width);

  /* 宽度不做过渡：它会让右侧复杂页面在每一帧重新布局。 */
  background: linear-gradient(180deg, rgba(254, 242, 248, 0.9) 0%, rgba(240, 249, 255, 0.92) 100%);
  border-right: 1px solid var(--ui-border-subtle);
  backdrop-filter: blur(20px) saturate(1.1);
}

/* 深色: 深紫蓝夜空 */
[data-theme='dark'] .main-nav {
  background: linear-gradient(180deg, rgba(26, 21, 38, 0.95) 0%, rgba(15, 16, 26, 0.97) 100%);
  border-right: 1px solid rgba(139, 92, 246, 0.15);
}

/* 像素噪点纹理(极轻) */
.main-nav-pixel-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.03;
  background-image: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    currentColor 2px,
    currentColor 3px
  );
  color: var(--ui-accent-primary);
  z-index: 0;
}

/* ═══════════════════════════════════════════════════════════════
 * 品牌区
 * ═══════════════════════════════════════════════════════════════ */

.main-nav-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 16px 16px;
  position: relative;
  z-index: 1;
}

.main-nav-logo {
  width: 36px;
  height: 36px;
  overflow: hidden;
  flex-shrink: 0;
  /* 像素边框 */
  box-shadow:
    -2px 0 0 0 var(--color-moe-cocoa),
    2px 0 0 0 var(--color-moe-cocoa),
    0 -2px 0 0 var(--color-moe-cocoa),
    0 2px 0 0 var(--color-moe-cocoa);
}

[data-theme='dark'] .main-nav-logo {
  box-shadow:
    -2px 0 0 0 var(--ui-accent-purple),
    2px 0 0 0 var(--ui-accent-purple),
    0 -2px 0 0 var(--ui-accent-purple),
    0 2px 0 0 var(--ui-accent-purple),
    0 0 12px rgba(167, 139, 250, 0.3);
}

.main-nav-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.main-nav-brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.main-nav-brand-sub {
  font-size: 9px;
  font-weight: 700;
  color: var(--ui-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.main-nav-brand-name {
  font-size: 16px;
  font-weight: 900;
  background: linear-gradient(135deg, var(--ui-text-primary), var(--ui-accent-sky));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* ═══════════════════════════════════════════════════════════════
 * 固定按钮
 * ═══════════════════════════════════════════════════════════════ */

.main-nav-pin {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--ui-bg-surface);
  color: var(--ui-text-tertiary);
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  border: 1px solid var(--ui-border-subtle);
  transition: all var(--ui-duration-fast) var(--ui-ease-standard);
  flex-shrink: 0;
}

.main-nav-pin:hover {
  color: var(--ui-accent-primary);
  border-color: var(--ui-accent-primary);
  box-shadow: var(--ui-glow-pink);
}

.main-nav-pin--pinned {
  color: var(--ui-accent-primary);
  background: var(--ui-accent-primary-soft);
  border-color: var(--ui-accent-primary);
}

[data-theme='dark'] .main-nav-pin {
  background: rgba(30, 27, 45, 0.8);
  border-color: rgba(139, 92, 246, 0.2);
}

[data-theme='dark'] .main-nav-pin:hover,
[data-theme='dark'] .main-nav-pin--pinned {
  border-color: var(--ui-accent-purple);
  box-shadow: var(--ui-glow-purple);
}

/* 收起态: 单独一行居中 */
.main-nav-pin-row {
  display: flex;
  justify-content: center;
  padding: 0 0 8px;
  position: relative;
  z-index: 1;
}

.main-nav-pin--collapsed {
  /* 收起态样式微调 */
}

/* ═══════════════════════════════════════════════════════════════
 * 导航列表
 * ═══════════════════════════════════════════════════════════════ */

.main-nav-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 10px 12px;
  position: relative;
  z-index: 1;
}

.main-nav-list::-webkit-scrollbar {
  width: 3px;
}

.main-nav-list::-webkit-scrollbar-thumb {
  background: var(--ui-scrollbar-thumb);
}

/* ═══════════════════════════════════════════════════════════════
 * 分组
 * ═══════════════════════════════════════════════════════════════ */

.main-nav-group {
  margin-bottom: 10px;
}

.main-nav-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 8px 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--ui-radius-xs);
}

.main-nav-group-title:hover {
  background: var(--ui-bg-hover);
}

.main-nav-group-label {
  font-size: 9px;
  font-weight: 800;
  color: var(--ui-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.main-nav-group-chevron {
  color: var(--ui-text-tertiary);
  transition: transform var(--ui-duration-fast);
}

.main-nav-group-title--expanded .main-nav-group-chevron {
  transform: rotate(180deg);
}

/* ═══════════════════════════════════════════════════════════════
 * 导航项
 * ═══════════════════════════════════════════════════════════════ */

.main-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--ui-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  transition: all var(--ui-duration-fast) var(--ui-ease-standard);
  margin-bottom: 1px;
  text-align: left;
}

.main-nav-item:hover {
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
  transform: translateX(var(--ui-motion-distance-sm));
}

.main-nav-item:active:not(:disabled) {
  transform: translateX(var(--ui-motion-distance-sm)) scale(var(--ui-motion-scale-press));
}

/* 首次加载时旧页面保持可见，仅目标项显示低成本状态反馈。 */
.main-nav-item--pending:not(.main-nav-item--active) {
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
  box-shadow: inset 2px 0 0 var(--ui-accent-sky);
}

.main-nav-item--pending .main-nav-item-icon {
  animation: nav-pending 0.55s steps(2) infinite;
}

@keyframes nav-pending {
  50% {
    opacity: 0.45;
  }
}

[data-motion='reduced'] .main-nav-item--pending .main-nav-item-icon,
[data-motion='off'] .main-nav-item--pending .main-nav-item-icon {
  animation: none;
}

/* 选中态: 像素光轨 + 发光 */
.main-nav-item--active {
  background: var(--ui-bg-active);
  color: var(--ui-accent-primary);
  font-weight: 600;
  /* 像素光轨效果 */
  box-shadow:
    inset 3px 0 0 0 var(--ui-accent-primary),
    var(--ui-glow-pink);
}

[data-theme='dark'] .main-nav-item--active {
  background: rgba(139, 92, 246, 0.15);
  color: var(--ui-accent-purple);
  box-shadow:
    inset 3px 0 0 0 var(--ui-accent-purple),
    var(--ui-glow-purple);
}

/* 像素光轨动画 */
.main-nav-item-trail {
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: var(--ui-accent-primary);
  border-radius: 0 2px 2px 0;
}

[data-theme='dark'] .main-nav-item-trail {
  background: var(--ui-accent-purple);
  box-shadow: 0 0 8px rgba(167, 139, 250, 0.5);
}

.main-nav-item--disabled {
  color: var(--ui-text-disabled);
  cursor: not-allowed;
}

.main-nav-item--disabled:hover {
  background: transparent;
  color: var(--ui-text-disabled);
}

/* 图标 */
.main-nav-item-icon {
  flex-shrink: 0;
  color: var(--ui-text-tertiary);
  transition: color var(--ui-duration-fast);
}

.main-nav-item--active .main-nav-item-icon {
  color: var(--ui-accent-primary);
}

[data-theme='dark'] .main-nav-item--active .main-nav-item-icon {
  color: var(--ui-accent-purple);
}

/* 标签 */
.main-nav-item-label {
  font-family: var(--font-pixel);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ═══════════════════════════════════════════════════════════════
 * 收起态
 * ═══════════════════════════════════════════════════════════════ */

.main-nav--collapsed {
  width: var(--ui-nav-collapsed-width);
}

.main-nav--collapsed .main-nav-item {
  justify-content: center;
  padding: 10px;
}

/* 收起态: 品牌区只显示 Logo 居中 */
.main-nav--collapsed .main-nav-brand {
  justify-content: center;
  padding: 16px 12px 12px;
}

/* 收起态 Tooltip */
.main-nav-tooltip {
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%);
  padding: 5px 12px;
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-sm);
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-text-primary);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--ui-duration-fast),
    transform var(--ui-duration-fast);
  z-index: var(--ui-z-tooltip);
  box-shadow: var(--ui-shadow-md);
}

.main-nav--collapsed .main-nav-item:hover .main-nav-tooltip {
  opacity: 1;
  transform: translateY(-50%) translateX(2px);
}

/* ═══════════════════════════════════════════════════════════════
 * 底部区域
 * ═══════════════════════════════════════════════════════════════ */

.main-nav-footer {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px;
  border-top: 1px solid var(--ui-border-subtle);
  position: relative;
  z-index: 1;
}

[data-theme='dark'] .main-nav-footer {
  border-top-color: rgba(139, 92, 246, 0.15);
}

.main-nav-version-btn,
.main-nav-theme-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: var(--ui-text-secondary);
  cursor: pointer;
  border-radius: var(--ui-radius-sm);
  font-size: 12px;
  font-weight: 500;
  transition: all var(--ui-duration-fast);
}

.main-nav-version-btn {
  color: var(--ui-accent-sky, #0ea5e9);
  border: 1px solid color-mix(in srgb, var(--ui-accent-sky, #0ea5e9) 24%, transparent);
  background: color-mix(in srgb, var(--ui-accent-sky, #0ea5e9) 5%, transparent);
}

.main-nav-version-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.main-nav-version-label {
  color: var(--ui-text-secondary);
}

.main-nav-version-value {
  font-size: 8px;
  color: var(--ui-accent-sky, #0ea5e9);
}

.main-nav-version-btn:hover,
.main-nav-theme-btn:hover {
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}

.main-nav-version-btn:hover {
  border-color: var(--ui-accent-sky, #0ea5e9);
  box-shadow: 2px 2px 0 color-mix(in srgb, var(--ui-accent-sky, #0ea5e9) 18%, transparent);
}

.main-nav-version-btn:disabled {
  opacity: 0.55;
  cursor: default;
  box-shadow: none;
}

.main-nav--collapsed .main-nav-version-copy {
  display: none;
}

.main-nav--collapsed .main-nav-version-btn:hover .main-nav-tooltip {
  opacity: 1;
  transform: translateY(-50%) translateX(2px);
}

/* 减少动画偏好 */
@media (prefers-reduced-motion: reduce) {
  .main-nav {
    transition: none;
  }
}
</style>

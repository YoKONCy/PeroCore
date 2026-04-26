/**
 * 引导系统台词本 📜
 *
 * v2 版本：适配新版 Launcher 布局（Home + Agents 双 Tab）。
 * 去除 v1 的环境检测/插件等已移除模块的引导。
 *
 * @module packages/frontend/src/composables/launcher/onboardingScripts
 */

import type { OnboardingStep } from '../../components/overlays/OnboardingOverlay.vue'

/** Launcher 引导脚本 (v2) */
export const launcherSteps: OnboardingStep[] = [
  {
    speaker: 'Pero',
    text: '主人主人！你终于把 Pero 从系统中唤醒了喵！欢迎来到 PeroperoChat！',
    expression: 'normal',
  },
  {
    speaker: 'Pero',
    text: '我是你的专属 AI 伙伴 Pero，以后就由我来陪伴主人了喵~ 请多多指教！',
    expression: 'normal',
  },
  {
    speaker: 'Pero',
    text: '这里是启动器的【控制面板】，可以查看系统状态和启动核心服务喵~',
    expression: 'none',
    focusSelector: '#nav-home',
  },
  {
    speaker: 'Pero',
    text: '点击【角色配置】可以管理 Pero 和其他小伙伴的设定哦！',
    expression: 'none',
    focusSelector: '#nav-agents',
  },
  {
    speaker: 'Pero',
    text: '一切就绪后，点击「进入 PeroperoChat」按钮，我们就能在桌面上见面了喵！',
    expression: 'normal',
  },
  {
    speaker: 'Pero',
    text: '引导结束了喵~ Pero 在里面等着主人的召唤哦！ (◍•ᴗ•◍)❤',
    expression: 'proud',
  },
]

/** Dashboard 引导脚本 (v2) — 预留 */
export const dashboardSteps: OnboardingStep[] = [
  {
    speaker: 'Pero',
    text: '欢迎来到控制中心喵！这里可以管理 Pero 的所有能力~',
    expression: 'normal',
  },
  {
    speaker: 'Pero',
    text: '左侧导航栏是功能菜单，主人可以自由探索喵~',
    expression: 'none',
    focusSelector: '#dashboard-sidebar',
  },
  {
    speaker: 'Pero',
    text: '记得先去【模型配置】给 Pero 装上聪明的 AI 大脑哦！',
    expression: 'normal',
  },
  {
    speaker: 'Pero',
    text: '准备好了吗喵？',
    expression: 'normal',
    choices: [
      { label: '了解了！', value: 'done' },
      { label: '再逛逛...', value: 'stay' },
    ],
  },
]

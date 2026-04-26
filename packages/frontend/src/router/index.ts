/**
 * Vue Router 配置
 *
 * Electron 模式: 各页面独立路由（窗口管理体系）
 * Docker/浏览器模式: WebShellView 外壳 + 嵌套子路由（单标签页）
 *
 * 路由采用懒加载 + keep-alive 白名单控制。
 *
 */

import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { isElectron } from '../utils/ipcAdapter'

// ── Electron 模式路由（保持不变） ──

const electronRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/launcher',
  },
  {
    path: '/chat',
    name: 'Chat',
    component: () => import('@/views/ChatView.vue'),
    meta: { title: '对话' },
  },
  {
    path: '/dashboard',
    name: 'DashboardView',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: '仪表盘' },
  },
  {
    path: '/work',
    name: 'Work',
    component: () => import('@/views/WorkView.vue'),
    meta: { title: '工作模式' },
  },
  {
    path: '/launcher',
    name: 'Launcher',
    component: () => import('@/views/LauncherView.vue'),
    meta: { title: '启动器' },
  },
  {
    path: '/pet',
    name: 'Pet',
    component: () => import('@/views/Pet3DView.vue'),
    meta: { title: '宠物' },
  },
  {
    path: '/pet-3d',
    name: 'PetStandalone',
    component: () => import('@/views/Pet3DView.vue'),
    meta: { title: '桌宠', standalone: true },
  },
  {
    path: '/stronghold',
    name: 'Stronghold',
    component: () => import('@/views/StrongholdView.vue'),
    meta: { title: '据点' },
  },
]

// ── Docker/浏览器模式路由 ──
// WebShellView 作为外壳，所有功能页面嵌套在 /app 下，
// Pet3DView 不注册（透明桌宠窗口在浏览器中无意义）。

const dockerRoutes: RouteRecordRaw[] = [
  {
    path: '/launcher',
    name: 'Launcher',
    component: () => import('@/views/LauncherView.vue'),
    meta: { title: '启动器' },
  },
  {
    path: '/app',
    name: 'WebShell',
    component: () => import('@/views/WebShellView.vue'),
    children: [
      {
        path: '',
        name: 'Chat',
        component: () => import('@/views/ChatView.vue'),
        meta: { title: '对话' },
      },
      {
        path: 'work',
        name: 'Work',
        component: () => import('@/views/WorkView.vue'),
        meta: { title: '工作模式' },
      },
      {
        path: 'stronghold',
        name: 'Stronghold',
        component: () => import('@/views/StrongholdView.vue'),
        meta: { title: '据点' },
      },
      {
        path: 'dashboard',
        name: 'DashboardView',
        component: () => import('@/views/DashboardView.vue'),
        meta: { title: '仪表盘' },
      },
    ],
  },
  // 根路径重定向到 /app (对话)
  {
    path: '/',
    redirect: '/app',
  },
  // 兜底: pet-3d 在 Docker 中不需要但 Electron HMR 时可能触发
  {
    path: '/pet-3d',
    name: 'PetFallback',
    component: () => import('@/views/Pet3DView.vue'),
    meta: { title: '桌宠', standalone: true },
  },
]

// ── 创建路由实例 ──

const routes = isElectron() ? electronRoutes : dockerRoutes

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// 路由切换时更新标题
router.afterEach((to) => {
  document.title = `${to.meta.title ?? 'PeroperoChat'} - PeroperoChat`
})

export default router

/**
 * Vue Router 配置
 *
 * 路由采用懒加载 + keep-alive 白名单控制。
 * @see 12_FRONTEND_PERFORMANCE.md §3.1
 */

import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
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
      path: '/stronghold',
      name: 'Stronghold',
      component: () => import('@/views/StrongholdView.vue'),
      meta: { title: '据点' },
    },
  ],
})

// 路由切换时更新标题
router.afterEach((to) => {
  document.title = `${to.meta.title ?? 'PeroperoChat'} - PeroperoChat`
})

export default router

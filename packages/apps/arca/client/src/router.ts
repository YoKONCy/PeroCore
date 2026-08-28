/**
 * router — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import SettingsView from './views/SettingsView.vue'
import WorkbenchView from './views/WorkbenchView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/document/:documentId?', name: 'workbench', component: WorkbenchView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
})

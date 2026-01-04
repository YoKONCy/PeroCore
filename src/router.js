import { createRouter, createWebHashHistory } from 'vue-router'
import PetView from './views/PetView.vue'
import DashboardView from './views/DashboardView.vue'
import TaskMonitorView from './views/TaskMonitorView.vue'

const routes = [
  { path: '/', redirect: '/pet' },
  { path: '/pet', component: PetView },
  { path: '/dashboard', component: DashboardView },
  { path: '/monitor', component: TaskMonitorView }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router

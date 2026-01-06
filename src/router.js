import { createRouter, createWebHashHistory } from 'vue-router'
import PetView from './views/PetView.vue'
import DashboardView from './views/DashboardView.vue'
import LauncherView from './views/LauncherView.vue'

const routes = [
  { path: '/', redirect: '/launcher' },
  { path: '/launcher', component: LauncherView },
  { path: '/pet', component: PetView },
  { path: '/dashboard', component: DashboardView }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router

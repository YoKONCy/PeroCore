import { createRouter, createWebHashHistory } from 'vue-router'
import Pet3DView from './views/Pet3DView.vue'
import DashboardView from './views/DashboardView.vue'
import LauncherView from './views/LauncherView.vue'
import MainWindow from './views/MainWindow.vue'
import BedrockAvatar from './components/avatar/BedrockAvatar.vue'

const routes = [
  { path: '/', redirect: '/launcher' },
  { path: '/launcher', component: LauncherView },
  { path: '/ide', component: MainWindow },
  { path: '/pet-3d', component: Pet3DView },
  { path: '/dashboard', component: DashboardView },
  { path: '/test-3d', component: BedrockAvatar }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  console.log(`[Router] Navigating from ${from.path} to ${to.path}`); // [路由] 正在从 ${from.path} 导航到 ${to.path}
  next();
});

export default router

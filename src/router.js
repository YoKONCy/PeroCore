import { createRouter, createWebHashHistory } from 'vue-router'
import PetView from './views/PetView.vue'
import DashboardView from './views/DashboardView.vue'
import LauncherView from './views/LauncherView.vue'
import MainWindow from './views/MainWindow.vue'

const routes = [
  { path: '/', redirect: '/launcher' },
  { path: '/launcher', component: LauncherView },
  { path: '/ide', component: MainWindow },
  { path: '/pet', component: PetView },
  { path: '/dashboard', component: DashboardView }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  console.log(`[Router] Navigating from ${from.path} to ${to.path}`);
  next();
});

export default router

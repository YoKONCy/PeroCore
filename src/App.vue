<template>
  <div id="app-root" style="width:100%; height:100%; background: transparent !important;">
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </router-view>
    <NotificationManager />
  </div>
</template>

<script setup>
import NotificationManager from './components/ui/NotificationManager.vue';
console.log('[App] App.vue initialized');

// 全局 JS 错误捕获
window.addEventListener('error', (event) => {
  if (window.$notify) {
    window.$notify(event.message, 'error', '前端异常');
  } else {
    console.error('Notification system not ready:', event.message);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (window.$notify) {
    // Promise 错误通常在 reason 中
    const msg = event.reason ? (event.reason.message || String(event.reason)) : 'Unknown Promise Error';
    window.$notify(msg, 'error', '未捕获的 Promise 异常');
  }
});
</script>

<style>
body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: transparent !important;
}

#app {
  width: 100%;
  height: 100%;
  background: transparent !important;
}
</style>

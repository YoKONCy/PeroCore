<template>
  <div class="app-container">
    <div class="main-content">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
      <NotificationManager />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import NotificationManager from './components/ui/NotificationManager.vue';
import { gatewayClient } from './api/gateway';

const testResult = ref('');

const testPing = async () => {
  testResult.value = 'Sending Ping...';
  try {
    const resp = await gatewayClient.sendRequest('broadcast', 'ping');
    testResult.value = `Success: ${resp.data}`;
    console.log('Ping 响应:', resp);
  } catch (e) {
    testResult.value = `Error: ${e.message}`;
    console.error('Ping 错误:', e);
  }
};

const testChat = async () => {
  testResult.value = 'Sending Chat...';
  let fullResponse = '';
  try {
    const resp = await gatewayClient.sendRequest(
        'broadcast', 
        'chat', 
        { text: 'Hello, who are you?' },
        (partial) => {
            console.log('部分响应:', partial.data);
            fullResponse += partial.data;
            testResult.value = `Agent Thinking:\n${fullResponse}`;
        }
    );
    // Final response data is empty string as per protocol, so we use fullResponse
    testResult.value = `Agent Response (Done):\n${fullResponse}`;
    console.log('对话响应完成:', resp);
  } catch (e) {
    testResult.value = `Error: ${e.message}`;
    console.error('对话错误:', e);
  }
};

console.log('[App] App.vue 已初始化');

onMounted(() => {
  // 启动网关连接
  gatewayClient.connect();
});

// 全局 JS 错误捕获
window.addEventListener('error', (event) => {
  if (window.$notify) {
    window.$notify(event.message, 'error', '前端异常');
  } else {
    console.error('通知系统未就绪:', event.message);
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

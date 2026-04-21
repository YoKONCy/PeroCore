<template>
  <div class="auth-gate-shell">
    <div class="auth-gate-card">
      <div class="auth-gate-badge">Protected</div>
      <h1>请输入访问密钥</h1>
      <p>
        当前 PeroCore 已启用管理鉴权。输入服务端配置的访问密钥后，才能继续访问 WebUI 与受保护 API。
      </p>
      <form class="auth-gate-form" @submit.prevent="submit">
        <label class="auth-gate-label" for="desktop-auth-key">访问密钥</label>
        <input
          id="desktop-auth-key"
          v-model="apiKey"
          class="auth-gate-input"
          type="password"
          autocomplete="current-password"
          :disabled="busy"
          placeholder="请输入 PERO_DESKTOP_API_KEY"
        />
        <label class="auth-gate-checkbox">
          <input v-model="remember" type="checkbox" :disabled="busy" />
          <span>记住此密钥（保存在当前浏览器）</span>
        </label>
        <button class="auth-gate-button" type="submit" :disabled="busy || !apiKey.trim()">
          {{ busy ? '验证中...' : '解锁 WebUI' }}
        </button>
      </form>
      <p class="auth-gate-meta">请求头：{{ headerName }}</p>
      <p v-if="error" class="auth-gate-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  busy: boolean
  error: string
  headerName: string
}>()

const emit = defineEmits<{
  unlock: [apiKey: string, remember: boolean]
}>()

const apiKey = ref('')
const remember = ref(true)

const submit = () => {
  emit('unlock', apiKey.value, remember.value)
}
</script>

<style scoped>
.auth-gate-shell {
  display: flex;
  min-height: 100vh;
  width: 100%;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background:
    radial-gradient(circle at top, rgba(255, 181, 230, 0.18), transparent 35%),
    linear-gradient(180deg, rgba(20, 16, 31, 0.98), rgba(12, 10, 18, 1));
}

.auth-gate-card {
  width: min(100%, 460px);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(24, 20, 36, 0.92);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
  padding: 28px;
  color: #f8f4ff;
}

.auth-gate-badge {
  display: inline-flex;
  margin-bottom: 16px;
  border-radius: 999px;
  background: rgba(236, 72, 153, 0.18);
  color: #f9a8d4;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.auth-gate-card h1 {
  margin: 0 0 12px;
  font-size: 28px;
}

.auth-gate-card p {
  margin: 0;
  color: rgba(248, 244, 255, 0.72);
  line-height: 1.6;
}

.auth-gate-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 24px;
}

.auth-gate-label {
  font-size: 14px;
  color: rgba(248, 244, 255, 0.82);
}

.auth-gate-input {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(10, 8, 18, 0.9);
  color: #fff;
  padding: 14px 16px;
  font-size: 15px;
  outline: none;
}

.auth-gate-input:focus {
  border-color: rgba(236, 72, 153, 0.9);
  box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.2);
}

.auth-gate-checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: rgba(248, 244, 255, 0.74);
}

.auth-gate-button {
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  color: #fff;
  padding: 14px 16px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.auth-gate-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.auth-gate-meta {
  margin-top: 16px !important;
  font-size: 13px;
}

.auth-gate-error {
  margin-top: 12px !important;
  color: #fda4af !important;
  font-size: 14px;
}
</style>

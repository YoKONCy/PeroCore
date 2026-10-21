<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { ref } from 'vue'
import InfosLogo from '../brands/InfosLogo.vue'
import { clientAccessApi } from '../../api/modules/clientAccessApi'
import { getWebServerOrigin, setWebServerOrigin } from '../../api/transport'
import { useClientSession } from '../../composables/system/useClientSession'

const { checking, error, check } = useClientSession()
const mode = ref<'pair' | 'login'>('pair')
const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
const code = ref(params.get('pair') || '')
const name = ref(/Mobile|Android|iPhone/i.test(navigator.userAgent) ? '我的手机' : '我的浏览器')
const remember = ref(true)
const busy = ref(false)
const failure = ref('')
const serverOrigin = getWebServerOrigin()
const anotherServer = serverOrigin !== window.location.origin
function selectMode(next: 'pair' | 'login') {
  mode.value = next
  code.value = ''
}
function useThisServer() {
  setWebServerOrigin(window.location.origin)
  window.location.reload()
}
async function connect() {
  if (busy.value || !code.value.trim()) return
  busy.value = true
  failure.value = ''
  try {
    await clientAccessApi.connect(mode.value, code.value.trim(), name.value, remember.value)
    // 短期配对码只用于兑换，成功后从地址与历史入口中移除。
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}#/app`,
    )
    window.location.reload()
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : '配对失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="client-pairing">
    <form class="client-pairing-card" @submit.prevent="connect">
      <InfosLogo class="client-pairing-logo" variant="wordmark" />
      <p class="client-pairing-eyebrow">{{ __t('ui.connection', '连接你的 infOS') }}</p>
      <h1>{{ __t('ui.connection', '同一份工作，随处接续') }}</h1>
      <p>{{ __t('ui.connection', '请在「分布式」中生成配对码，或扫描二维码。') }}</p>
      <p v-if="anotherServer">
        {{ __t('ui.connection', '当前连接') }} {{ serverOrigin
        }}{{ __t('ui.connection', '。配对请') }}
        <a :href="`${serverOrigin}/#/app`">{{ __t('ui.connection', '打开服务端入口') }}</a>
        {{ __t('ui.connection', '，或') }}
        <button type="button" @click="useThisServer">
          {{ __t('ui.connection', '切回本页服务器') }}
        </button>
        。
      </p>
      <div class="client-pairing-tabs" :aria-label="__t('ui.connection', '登录方式')">
        <button type="button" :aria-pressed="mode === 'pair'" @click="selectMode('pair')">
          {{ __t('ui.connection', '设备配对') }}
        </button>
        <button type="button" :aria-pressed="mode === 'login'" @click="selectMode('login')">
          {{ __t('ui.connection', '管理凭据') }}
        </button>
      </div>
      <label>
        {{
          mode === 'pair' ? __t('ui.connection', '配对码') : __t('ui.connection', '服务端管理凭据')
        }}
        <input
          v-model="code"
          :type="mode === 'pair' ? 'text' : 'password'"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          required
          :maxlength="512"
        />
      </label>
      <label>
        {{ __t('ui.connection', '设备名称') }}
        <input v-model="name" maxlength="80" autocomplete="off" required />
      </label>
      <label class="client-remember">
        <input v-model="remember" type="checkbox" />
        {{ __t('ui.connection', '保持登录 30 天') }}
      </label>
      <p v-if="mode === 'pair'" class="client-pairing-help">
        {{ __t('ui.connection', '首次登录可使用服务端控制台的管理配对码（5 分钟有效）。') }}
      </p>
      <p v-if="failure || error" role="alert" class="client-pairing-error">
        {{ failure || error }}
      </p>
      <button class="client-connect" type="submit" :disabled="busy || checking || !code.trim()">
        {{ busy ? __t('ui.connection', '连接中…') : __t('ui.connection', '连接此设备') }}
      </button>
      <button type="button" class="client-recheck" :disabled="checking" @click="check">
        {{ checking ? __t('ui.connection', '检查连接中…') : __t('ui.connection', '重新检查连接') }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.client-pairing {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: max(24px, env(safe-area-inset-top)) 20px;
  background: radial-gradient(ellipse at top, #37304d, #11121c 70%);
  color: #eae6f5;
}
.client-pairing-card {
  width: min(100%, 420px);
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.client-pairing-logo {
  width: 130px;
  height: 48px;
}
.client-pairing-eyebrow {
  color: #b9a4ec;
  font-size: 13px;
  letter-spacing: 0.12em;
}
h1 {
  font-size: 24px;
  font-weight: 650;
}
p {
  line-height: 1.8;
  font-size: 14px;
  color: #b7b5c8;
  margin: 0;
}
label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
}
input:not([type='checkbox']) {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  font-size: 16px;
  background: #ffffff09;
  border: 1px solid #74628d;
  color: inherit;
  padding: 10px 12px;
}
button {
  min-height: 44px;
  padding: 8px 12px;
  cursor: pointer;
  border: 1px solid #736186;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.client-pairing-tabs {
  display: flex;
  gap: 8px;
}
.client-pairing-tabs button {
  flex: 1;
  background: transparent;
  color: inherit;
}
.client-pairing-tabs button[aria-pressed='true'],
.client-connect {
  background: #73529b;
  color: white;
}
.client-remember {
  flex-direction: row;
  align-items: center;
  min-height: 30px;
}
.client-remember input {
  width: 20px;
  height: 20px;
}
.client-pairing-help {
  font-size: 12px;
}
.client-pairing-error {
  color: #ff9fbc;
}
.client-recheck {
  color: #c2b2e5;
  background: transparent;
}
</style>

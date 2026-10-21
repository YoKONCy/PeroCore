<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { PBadge, PButton, PCard, PInput, PSwitch, PixelIcon } from '../pixel'
import { useClientAccess } from '../../composables/system/useClientAccess'
import { isElectronRuntime } from '../../api/transport'
import { computed, ref, useId, watch } from 'vue'

const {
  session,
  status,
  enabled,
  port,
  busy,
  error,
  code,
  remaining,
  address,
  addresses,
  normalizedAddress,
  pairingUrl,
  qr,
  refresh,
  save,
  createPairing,
  revoke,
  logout,
} = useClientAccess()
const isDesktop = isElectronRuntime()
const desktopAccess = computed(() => isDesktop && !status.value?.managedByDocker)
const accessTitle = computed(() =>
  desktopAccess.value
    ? __t('ui.connection', '局域网与设备')
    : __t('ui.connection', '服务访问与设备'),
)
const settingsId = useId()
const titleId = `${settingsId}-title`
const switchLabelId = `${settingsId}-enabled`
const switchHintId = `${settingsId}-enabled-hint`
const portId = `${settingsId}-port`
const addressId = `${settingsId}-address`
const addressOptionsId = `${settingsId}-addresses`
const portBinding = ref('')
watch(
  port,
  (value) => {
    portBinding.value = String(value)
  },
  { immediate: true },
)
const validPort = computed(() => {
  const value = Number(portBinding.value)
  return Number.isInteger(value) && value >= 1024 && value <= 65535
})
async function applySettings() {
  if (!validPort.value) return
  port.value = Number(portBinding.value)
  await save()
}
const date = (value: number) => new Date(value).toLocaleString()
</script>

<template>
  <PCard
    pixel
    padding="lg"
    overflow-visible
    class="client-access-settings"
    role="region"
    :aria-labelledby="titleId"
  >
    <header class="client-access-header">
      <div class="client-access-heading">
        <h3 :id="titleId" class="client-access-title">
          <PixelIcon name="network" size="sm" />
          {{ accessTitle }}
        </h3>
        <p class="client-access-description">
          {{ __t('ui.connection', '在其他设备上访问会话、文件和任务。') }}
        </p>
      </div>
      <PButton variant="secondary" size="sm" :disabled="busy" @click="refresh">
        <PixelIcon name="refresh" size="sm" :animation="busy ? 'spin' : undefined" />
        {{ __t('ui.connection', '刷新') }}
      </PButton>
    </header>
    <template v-if="session.admin">
      <template v-if="!status?.managedByDocker">
        <div class="client-access-row">
          <div class="client-access-row-copy">
            <strong :id="switchLabelId">
              {{
                desktopAccess
                  ? __t('ui.connection', '允许局域网访问')
                  : __t('ui.connection', '启用独立访问入口')
              }}
            </strong>
            <p :id="switchHintId">
              {{
                desktopAccess
                  ? __t('ui.connection', '开启后，可在同一网络内通过手机浏览器配对。')
                  : __t('ui.connection', '允许其他设备通过此端口连接。')
              }}
            </p>
          </div>
          <PSwitch
            v-model="enabled"
            :disabled="busy || !status"
            :aria-labelledby="switchLabelId"
            :aria-describedby="switchHintId"
          />
        </div>
        <div class="client-access-row client-access-port-row">
          <div class="client-access-row-copy">
            <label :for="portId" class="client-access-label">
              {{ __t('ui.connection', '监听端口') }}
            </label>
            <p>
              {{
                desktopAccess
                  ? __t('ui.connection', '修改后点击「应用设置」。')
                  : __t('ui.connection', '仅修改独立入口的端口。')
              }}
            </p>
          </div>
          <div class="client-access-actions">
            <PInput
              :id="portId"
              v-model="portBinding"
              class="client-access-port"
              type="number"
              size="sm"
              inputmode="numeric"
              :min="1024"
              :max="65535"
              :disabled="busy || !status"
            />
            <PButton size="sm" :disabled="busy || !status || !validPort" @click="applySettings">
              <PixelIcon name="save" size="sm" />
              {{ busy ? __t('ui.connection', '处理中…') : __t('ui.connection', '应用设置') }}
            </PButton>
          </div>
        </div>
      </template>
      <div v-else class="client-access-deployment">
        <PBadge size="sm">Docker</PBadge>
        <div class="client-access-row-copy">
          <strong>{{ __t('ui.connection', '使用部署入口') }}</strong>
          <p>{{ __t('ui.connection', '使用部署的 IP 或域名配对。') }}</p>
        </div>
      </div>
      <p v-if="status && !status.listening" class="client-access-hint">
        {{
          desktopAccess
            ? __t('ui.connection', '局域网入口已关闭。')
            : __t('ui.connection', '独立入口已关闭，现有 Web 地址仍可使用。')
        }}
      </p>

      <section v-if="status && (status.listening || !isDesktop)" class="client-access-section">
        <h4 class="client-access-subtitle">{{ __t('ui.connection', '配对新设备') }}</h4>
        <div class="client-access-address-row">
          <div class="client-access-address">
            <label :for="addressId" class="client-access-label">
              {{
                desktopAccess
                  ? __t('ui.connection', '手机访问地址')
                  : __t('ui.connection', '设备访问地址')
              }}
            </label>
            <PInput
              :id="addressId"
              v-model="address"
              size="sm"
              :list="addressOptionsId"
              inputmode="url"
              autocomplete="off"
              :spellcheck="false"
              :placeholder="
                desktopAccess
                  ? __t('ui.connection', 'http://电脑局域网IP:端口')
                  : __t('ui.connection', 'https://你的服务域名 或 http://服务器IP:端口')
              "
              :disabled="busy"
            />
            <datalist :id="addressOptionsId">
              <option v-for="item in addresses" :key="item" :value="item" />
            </datalist>
          </div>
          <PButton size="sm" :disabled="busy || !normalizedAddress" @click="createPairing">
            <PixelIcon name="link" size="sm" />
            {{ code ? __t('ui.connection', '重新生成配对码') : __t('ui.connection', '生成配对码') }}
          </PButton>
        </div>
        <p v-if="!addresses.length" class="client-access-hint">
          {{ __t('ui.connection', '填写设备可访问的 IP 或域名，不使用容器内部地址或 localhost。') }}
        </p>
        <p v-if="address && !normalizedAddress" class="client-access-error" role="alert">
          {{ __t('ui.connection', '请填 HTTP/HTTPS 地址，不含路径或 localhost。') }}
        </p>
        <p class="client-access-hint">
          {{
            desktopAccess
              ? __t(
                  'ui.connection',
                  '用手机相机扫码，或打开地址输入配对码。连接失败时检查网络和防火墙。',
                )
              : __t('ui.connection', '扫码配对，或在浏览器打开地址并输入配对码。')
          }}
        </p>
        <div v-if="code" class="client-access-pairing">
          <img
            v-if="qr"
            :src="qr"
            :alt="__t('ui.connection', '设备配对二维码')"
            width="192"
            height="192"
          />
          <div class="client-access-pairing-copy">
            <span class="client-access-label">{{ __t('ui.connection', '一次性配对码') }}</span>
            <strong class="client-access-code">{{ code }}</strong>
            <p class="client-access-description">
              {{
                remaining > 0
                  ? __t('ui.connection', '{0} 秒内有效，仅可兑换一次', [remaining])
                  : __t('ui.connection', '配对码已过期，请重新生成')
              }}
            </p>
            <PButton
              v-if="pairingUrl"
              :href="pairingUrl"
              variant="secondary"
              size="sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              <PixelIcon name="globe" size="sm" />
              {{ __t('ui.connection', '打开配对页面') }}
            </PButton>
            <p class="client-access-hint">
              {{ __t('ui.connection', '配对后可访问数据并执行任务，请仅授权可信设备。') }}
            </p>
          </div>
        </div>
      </section>
      <p v-if="status?.lastError || error" role="alert" class="client-access-error">
        {{ error || status?.lastError }}
      </p>
      <section class="client-access-section">
        <h4 class="client-access-subtitle">
          {{ __t('ui.connection', '已配对设备') }}
          <PBadge size="sm">{{ status?.devices.length ?? 0 }}</PBadge>
        </h4>
        <p v-if="!status?.devices.length" class="client-access-empty">
          {{ __t('ui.connection', '暂无已配对设备。') }}
        </p>
        <ul v-else class="client-access-devices">
          <li v-for="device in status?.devices || []" :key="device.id" class="client-access-device">
            <div class="client-access-row-copy">
              <strong>{{ device.name }}</strong>
              <p>
                {{ device.admin ? __t('ui.connection', '管理员') : __t('ui.connection', '客户端') }}
                {{ __t('ui.connection', '· 有效至') }} {{ date(device.expiresAt) }}
              </p>
            </div>
            <PButton variant="secondary" size="sm" :disabled="busy" @click="revoke(device.id)">
              {{ __t('ui.connection', '撤销授权') }}
            </PButton>
          </li>
        </ul>
      </section>
    </template>
    <p v-else class="client-access-description">
      {{ __t('ui.connection', '已配对。设备授权由管理员在「分布式」中管理。') }}
    </p>
    <div v-if="!isDesktop" class="client-access-footer">
      <PButton variant="secondary" size="sm" :disabled="busy" @click="logout">
        <PixelIcon name="logout" size="sm" />
        {{ __t('ui.connection', '退出此设备') }}
      </PButton>
    </div>
  </PCard>
</template>

<style scoped>
.client-access-settings {
  min-width: 0;
}

.client-access-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
}

.client-access-heading,
.client-access-row-copy {
  min-width: 0;
}

.client-access-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--ui-text-primary);
  font-family: var(--font-pixel);
  font-size: 14px;
  font-weight: 700;
}

.client-access-description,
.client-access-row-copy p,
.client-access-empty {
  margin: 5px 0 0;
  color: var(--ui-text-secondary);
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.client-access-row,
.client-access-device {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-top: 1px solid var(--ui-border-subtle);
}

.client-access-row-copy strong,
.client-access-label {
  color: var(--ui-text-primary);
  font-size: 12px;
  font-weight: 600;
}

.client-access-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.client-access-port {
  width: 104px;
}

.client-access-section {
  margin-top: 14px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border-subtle);
}

.client-access-deployment {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border-default);
  background: var(--dash-panel-soft);
}

.client-access-subtitle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  color: var(--ui-text-primary);
  font-family: var(--font-pixel);
  font-size: 12px;
  font-weight: 600;
}

.client-access-address-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
}

.client-access-address {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.client-access-hint {
  margin: 10px 0 0;
  color: var(--ui-text-tertiary);
  font-size: 10px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.client-access-pairing {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  margin-top: 14px;
  padding: 16px;
  border: 1px solid var(--ui-border-default);
  background: var(--dash-panel-soft);
}

.client-access-pairing img {
  flex-shrink: 0;
  width: 192px;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  image-rendering: pixelated;
  background: white;
}

.client-access-pairing-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: min(100%, 160px);
}

.client-access-code {
  max-width: 100%;
  color: var(--ui-accent-sky);
  font-family: var(--ui-font-mono, monospace);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.1em;
  overflow-wrap: anywhere;
  user-select: all;
}

.client-access-devices {
  margin: 0;
  padding: 0;
  list-style: none;
}

.client-access-device:first-child {
  border-top: 0;
}

.client-access-empty {
  margin: 0;
}

.client-access-error {
  margin: 10px 0 0;
  color: var(--ui-text-error, var(--ui-danger));
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.client-access-footer {
  margin-top: 16px;
}

@media (max-width: 640px) {
  .client-access-port-row,
  .client-access-device {
    flex-wrap: wrap;
  }

  .client-access-actions {
    width: 100%;
  }

  .client-access-port {
    flex: 1;
    width: 0;
  }

  .client-access-address-row {
    grid-template-columns: minmax(0, 1fr);
    justify-items: start;
  }

  .client-access-address {
    width: 100%;
  }

  .client-access-pairing {
    gap: 14px;
    padding: 12px;
  }
}
</style>

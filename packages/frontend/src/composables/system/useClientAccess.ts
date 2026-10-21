import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import qrcode from 'qrcode-generator'
import { clientAccessApi, type AccessStatus } from '../../api/modules/clientAccessApi'
import { getWebServerOrigin, isElectronRuntime } from '../../api/transport'
import { useClientSession } from './useClientSession'

export function useClientAccess() {
  const { session, logout } = useClientSession()
  const status = ref<AccessStatus>()
  const enabled = ref(false)
  const port = ref(9122)
  const busy = ref(false)
  const error = ref('')
  const code = ref('')
  const expiresAt = ref(0)
  const remaining = ref(0)
  const address = ref('')
  const addresses = computed(() => {
    if (!status.value) return []
    // 浏览器当前入口已经可达，优先用于配对，避免选中服务端内部网卡地址。
    if (!isElectronRuntime()) {
      const current = new URL(getWebServerOrigin())
      if (!['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(current.hostname))
        return [...new Set([current.origin, ...status.value.addresses])]
    }
    return status.value.addresses
  })
  const normalizedAddress = computed(() => {
    try {
      const url = new URL(address.value)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)
      )
        return ''
      return url.origin
    } catch {
      return ''
    }
  })
  const pairingUrl = computed(() =>
    normalizedAddress.value && code.value && remaining.value > 0
      ? `${normalizedAddress.value}/#/app?pair=${encodeURIComponent(code.value)}`
      : '',
  )
  const qr = computed(() => {
    if (!pairingUrl.value) return ''
    const image = qrcode(0, 'M')
    image.addData(pairingUrl.value)
    image.make()
    return image.createDataURL(5, 16)
  })
  async function perform(action: () => Promise<void>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '操作失败，请重试'
    } finally {
      busy.value = false
    }
  }
  function apply(value: AccessStatus | undefined) {
    const previousAddresses = addresses.value
    status.value = value
    if (!value) return
    enabled.value = value.enabled
    port.value = value.port
    if (
      !address.value ||
      (previousAddresses.includes(address.value) && !addresses.value.includes(address.value))
    )
      address.value = addresses.value[0] || ''
  }
  async function refresh() {
    await perform(async () => {
      if (session.value.admin) apply((await clientAccessApi.status()).data)
    })
  }
  async function save() {
    await perform(async () => {
      try {
        apply((await clientAccessApi.configure(enabled.value, Number(port.value))).data)
      } catch (cause) {
        apply((await clientAccessApi.status()).data)
        throw cause
      }
      code.value = ''
    })
  }
  async function createPairing() {
    if (!normalizedAddress.value) {
      error.value = '请填写目标设备可访问的 HTTP 或 HTTPS 服务端地址，不能使用 localhost'
      return
    }
    await perform(async () => {
      const value = (await clientAccessApi.pairing()).data
      code.value = value?.code || ''
      expiresAt.value = value?.expiresAt || 0
      remaining.value = Math.max(0, Math.ceil((expiresAt.value - Date.now()) / 1000))
    })
  }
  async function revoke(id: string) {
    await perform(async () => {
      await clientAccessApi.revoke(id)
      if (id === session.value.deviceId) {
        window.location.reload()
        return
      }
      apply((await clientAccessApi.status()).data)
    })
  }
  let clock: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    void refresh()
    clock = setInterval(() => {
      remaining.value = Math.max(0, Math.ceil((expiresAt.value - Date.now()) / 1000))
    }, 1000)
  })
  onBeforeUnmount(() => clearInterval(clock))
  return {
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
  }
}

/**
 * useChatBackground — 三大聊天页面共享背景状态
 *
 * 从服务端配置恢复参数，并把实时预览值投影为 MainView 可消费的 CSS 变量。
 * 图片二进制由服务端持久化，浏览器只保存当前会话的预览状态。
 */
import { computed, ref } from 'vue'
import { configApi } from '../../api/modules/configApi'
import { systemApi, type ChatBackgroundSettings } from '../../api/modules/systemApi'

export const DEFAULT_CHAT_BACKGROUND: ChatBackgroundSettings = {
  enabled: false,
  opacity: 0.38,
  blur: 8,
  brightness: 1,
  saturation: 0.9,
  contrast: 0.92,
  overlayOpacity: 0.42,
  surfaceOpacity: 0.86,
  surfaceBlur: 12,
  positionX: 50,
  positionY: 50,
  fit: 'cover',
}

const settings = ref<ChatBackgroundSettings>({ ...DEFAULT_CHAT_BACKGROUND })
const hasImage = ref(false)
const imageVersion = ref(Date.now())
const loaded = ref(false)

function normalize(raw: Partial<ChatBackgroundSettings>): ChatBackgroundSettings {
  return { ...DEFAULT_CHAT_BACKGROUND, ...raw }
}

export function useChatBackground() {
  const imageUrl = computed(() =>
    hasImage.value ? systemApi.chatBackgroundContentUrl(imageVersion.value) : '',
  )

  async function load(): Promise<void> {
    const response = await configApi.batch(['ui.chatBackground.settings', 'ui.chatBackground.mime'])
    const values = response.data ?? {}
    const raw = values['ui.chatBackground.settings']
    if (typeof raw === 'string' && raw) {
      try {
        settings.value = normalize(JSON.parse(raw) as Partial<ChatBackgroundSettings>)
      } catch {
        settings.value = { ...DEFAULT_CHAT_BACKGROUND }
      }
    }
    hasImage.value = typeof values['ui.chatBackground.mime'] === 'string'
    loaded.value = true
  }

  async function save(): Promise<void> {
    await configApi.set('ui.chatBackground.settings', JSON.stringify(settings.value))
  }

  async function upload(blob: Blob): Promise<void> {
    await systemApi.uploadChatBackground(blob)
    hasImage.value = true
    settings.value.enabled = true
    imageVersion.value = Date.now()
  }

  async function remove(): Promise<void> {
    await systemApi.deleteChatBackground()
    hasImage.value = false
    settings.value.enabled = false
    imageVersion.value = Date.now()
  }

  return { settings, hasImage, imageUrl, loaded, load, save, upload, remove }
}

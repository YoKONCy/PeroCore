import { ref } from 'vue'
import { getLocale, setLocale, onLocaleChange, translate } from '@infos/shared/i18n'
import '@infos/shared/i18n/catalogs/arca'

try {
  setLocale(localStorage.getItem('infos.language') ?? navigator.language)
} catch {
  /* 使用默认语言 */
}
const locale = ref(getLocale())
document.documentElement.lang = locale.value
onLocaleChange((value) => {
  locale.value = value
  document.documentElement.lang = value
})
window.addEventListener('storage', (event) => {
  if (event.key === 'infos.language' && event.newValue) setLocale(event.newValue)
})
export function t(scope: string, source: string, parameters: readonly unknown[] = []): string {
  return translate(scope, source, parameters, locale.value)
}

const bridge = (
  window as unknown as {
    electron?: {
      invoke?: (channel: string) => Promise<unknown>
      on?: (channel: string, listener: (value: unknown) => void) => unknown
    }
  }
).electron
bridge?.on?.('i18n:changed', (value) => setLocale(value))
void bridge
  ?.invoke?.('i18n:get-language')
  .then((value) => {
    if (value) setLocale(value)
  })
  .catch(() => {
    /* 独立模式无需宿主连接 */
  })

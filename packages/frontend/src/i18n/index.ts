import { ref } from 'vue'
import {
  getLocale,
  setLocale,
  onLocaleChange,
  normalizeLocale,
  translate,
  type AppLocale,
} from '@infos/shared/i18n'
import '@infos/shared/i18n/catalogs/frontend'

const STORAGE_KEY = 'infos.language'
try {
  setLocale(localStorage.getItem(STORAGE_KEY) ?? navigator.language)
} catch {
  /* 使用默认语言 */
}
export const appLocale = ref<AppLocale>(getLocale())
function applyLocale(value: AppLocale): void {
  appLocale.value = value
  if (typeof document !== 'undefined') document.documentElement.lang = value
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* 私密浏览模式下继续使用内存配置 */
  }
}
applyLocale(getLocale())
onLocaleChange(applyLocale)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && event.newValue) setLocale(event.newValue)
  })
  window.electron?.on?.('i18n:changed', (value) => setLocale(value))
  void window.electron
    ?.invoke?.('i18n:get-language')
    .then((value) => {
      if (value) setLocale(value)
    })
    .catch(() => {
      /* 独立浏览器无需原生语言同步 */
    })
}

/** 在渲染、计算属性中读取语言，使文案随语言切换更新。 */
export function t(scope: string, source: string, parameters: readonly unknown[] = []): string {
  return translate(scope, source, parameters, appLocale.value)
}
export function getDisplayLocale(): AppLocale {
  return appLocale.value
}
export function applyLanguage(value: unknown): AppLocale {
  const language = setLocale(normalizeLocale(value))
  if (typeof window !== 'undefined' && !window.electron?.embedded && !window.electron?.toastOverlay)
    void window.electron?.invoke?.('i18n:set-language', language).catch(() => {
      /* 服务端配置仍已保存 */
    })
  return language
}

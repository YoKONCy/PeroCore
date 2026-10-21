import { getLocale, setLocale, translate } from '@infos/shared/i18n'
import '@infos/shared/i18n/catalogs/backend'
import '@infos/shared/i18n/catalogs/social'

// 数据库尚未打开时允许用环境变量选择启动日志语言。
setLocale(process.env.INFOS_LANGUAGE ?? process.env.LANG)
export { getLocale, setLocale }
export const t = translate

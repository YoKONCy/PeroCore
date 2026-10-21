import { getLocale, setLocale, translate } from '../../../packages/shared/src/i18n'
import '../../../packages/shared/src/i18n/catalogs/electron'

setLocale(process.env.INFOS_LANGUAGE ?? process.env.LANG)
export { getLocale, setLocale }
export const t = translate

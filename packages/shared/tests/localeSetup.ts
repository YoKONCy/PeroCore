import { beforeEach } from 'vitest'
import { setLocale } from '../src/i18n'

/** 固定测试的初始语言，不继承 Runner 或开发机器的浏览器语言。 */
function resetLocale(): void {
  setLocale('zh-CN')
  if (typeof localStorage !== 'undefined') localStorage.setItem('infos.language', 'zh-CN')
}

resetLocale()
beforeEach(resetLocale)

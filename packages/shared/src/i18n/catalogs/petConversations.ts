import { registerCatalog } from '../index'
import zhCN from '../locales/zh-CN/ui/pet-conversations.json'
import zhTW from '../locales/zh-TW/ui/pet-conversations.json'
import enUS from '../locales/en-US/ui/pet-conversations.json'
registerCatalog('ui.pet-conversations', 'zh-CN', zhCN)
registerCatalog('ui.pet-conversations', 'zh-TW', zhTW)
registerCatalog('ui.pet-conversations', 'en-US', enUS)

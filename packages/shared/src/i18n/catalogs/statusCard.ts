import { registerCatalog } from '../index'
import simplified from '../locales/zh-CN/common/status-card.json'
import traditional from '../locales/zh-TW/common/status-card.json'
import english from '../locales/en-US/common/status-card.json'

registerCatalog('common.status-card', 'zh-CN', simplified)
registerCatalog('common.status-card', 'zh-TW', traditional)
registerCatalog('common.status-card', 'en-US', english)

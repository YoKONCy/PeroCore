import { registerCatalog } from '../index'
import simplified from '../locales/zh-CN/ui/resource-preview.json'
import traditional from '../locales/zh-TW/ui/resource-preview.json'
import english from '../locales/en-US/ui/resource-preview.json'

registerCatalog('ui.resource-preview', 'zh-CN', simplified)
registerCatalog('ui.resource-preview', 'zh-TW', traditional)
registerCatalog('ui.resource-preview', 'en-US', english)

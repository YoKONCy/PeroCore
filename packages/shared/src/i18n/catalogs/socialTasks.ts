import { registerCatalog } from '../index'
import simplified from '../locales/zh-CN/ui/social-tasks.json'
import traditional from '../locales/zh-TW/ui/social-tasks.json'
import english from '../locales/en-US/ui/social-tasks.json'

registerCatalog('ui.social-tasks', 'zh-CN', simplified)
registerCatalog('ui.social-tasks', 'zh-TW', traditional)
registerCatalog('ui.social-tasks', 'en-US', english)

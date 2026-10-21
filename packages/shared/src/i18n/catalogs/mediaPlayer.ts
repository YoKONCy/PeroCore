import { registerCatalog } from '../index'
import simplified from '../locales/zh-CN/ui/media-player.json'
import traditional from '../locales/zh-TW/ui/media-player.json'
import english from '../locales/en-US/ui/media-player.json'

registerCatalog('ui.media-player', 'zh-CN', simplified)
registerCatalog('ui.media-player', 'zh-TW', traditional)
registerCatalog('ui.media-player', 'en-US', english)

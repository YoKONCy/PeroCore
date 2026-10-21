// 按模块、语言分别维护词库；此入口只装配当前运行端需要的资源。
import { registerCatalog } from '../index'
import messages0 from '../locales/zh-CN/common/tools.json'
import messages1 from '../locales/zh-TW/common/tools.json'
import messages2 from '../locales/en-US/common/tools.json'
import messages3 from '../locales/zh-CN/errors/common.json'
import messages4 from '../locales/zh-TW/errors/common.json'
import messages5 from '../locales/en-US/errors/common.json'
import messages6 from '../locales/zh-CN/common/interface.json'
import messages7 from '../locales/zh-TW/common/interface.json'
import messages8 from '../locales/en-US/common/interface.json'
import messages9 from '../locales/zh-CN/common/prompts.json'
import messages10 from '../locales/zh-TW/common/prompts.json'
import messages11 from '../locales/en-US/common/prompts.json'
import messages12 from '../locales/zh-CN/apps/social/logs.json'
import messages13 from '../locales/zh-TW/apps/social/logs.json'
import messages14 from '../locales/en-US/apps/social/logs.json'
import messages15 from '../locales/zh-CN/apps/social/ui.json'
import messages16 from '../locales/zh-TW/apps/social/ui.json'
import messages17 from '../locales/en-US/apps/social/ui.json'
import messages18 from '../locales/zh-CN/errors/social.json'
import messages19 from '../locales/zh-TW/errors/social.json'
import messages20 from '../locales/en-US/errors/social.json'
registerCatalog('common.tools', 'zh-CN', messages0)
registerCatalog('common.tools', 'zh-TW', messages1)
registerCatalog('common.tools', 'en-US', messages2)
registerCatalog('errors.common', 'zh-CN', messages3)
registerCatalog('errors.common', 'zh-TW', messages4)
registerCatalog('errors.common', 'en-US', messages5)
registerCatalog('common.interface', 'zh-CN', messages6)
registerCatalog('common.interface', 'zh-TW', messages7)
registerCatalog('common.interface', 'en-US', messages8)
registerCatalog('common.prompts', 'zh-CN', messages9)
registerCatalog('common.prompts', 'zh-TW', messages10)
registerCatalog('common.prompts', 'en-US', messages11)
registerCatalog('apps.social.logs', 'zh-CN', messages12)
registerCatalog('apps.social.logs', 'zh-TW', messages13)
registerCatalog('apps.social.logs', 'en-US', messages14)
registerCatalog('apps.social.ui', 'zh-CN', messages15)
registerCatalog('apps.social.ui', 'zh-TW', messages16)
registerCatalog('apps.social.ui', 'en-US', messages17)
registerCatalog('errors.social', 'zh-CN', messages18)
registerCatalog('errors.social', 'zh-TW', messages19)
registerCatalog('errors.social', 'en-US', messages20)

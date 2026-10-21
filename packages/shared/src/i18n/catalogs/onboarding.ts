import { registerCatalog } from '../index'
import uiCN from '../locales/zh-CN/ui/onboarding.json'
import uiTW from '../locales/zh-TW/ui/onboarding.json'
import uiEN from '../locales/en-US/ui/onboarding.json'
import logsCN from '../locales/zh-CN/logs/frontend/onboarding.json'
import logsTW from '../locales/zh-TW/logs/frontend/onboarding.json'
import logsEN from '../locales/en-US/logs/frontend/onboarding.json'
registerCatalog('ui.onboarding', 'zh-CN', uiCN)
registerCatalog('ui.onboarding', 'zh-TW', uiTW)
registerCatalog('ui.onboarding', 'en-US', uiEN)
registerCatalog('logs.frontend.onboarding', 'zh-CN', logsCN)
registerCatalog('logs.frontend.onboarding', 'zh-TW', logsTW)
registerCatalog('logs.frontend.onboarding', 'en-US', logsEN)

import { t as __t } from '../i18n'
import type { Step } from '../types'

export function stepLabel(step?: Step, modelName?: string) {
  if (!step) return __t('apps.pictoria.ui', '便签')
  const provider =
    step.providerName ||
    (step.id.startsWith('builtin.apimodels.')
      ? 'APIModels'
      : step.id.startsWith('builtin.atlascloud.') || /^builtin\.image-/.test(step.id)
        ? 'AtlasCloud'
        : step.implementation?.kind === 'llm'
          ? 'infOS'
          : undefined)
  return [provider, step.modelName || modelName, step.name].filter(Boolean).join(' · ')
}
export function promptPlaceholder(step?: Step) {
  if (step?.id === 'builtin.image-edit' || step?.id === 'builtin.apimodels.image-edit')
    return __t('apps.pictoria.ui', '描述修改内容…')
  if (step?.id === 'builtin.image-generate' || step?.id === 'builtin.apimodels.image-generate')
    return __t('apps.pictoria.ui', '描述画面…')
  return step ? __t('apps.pictoria.ui', '输入提示词…') : __t('apps.pictoria.ui', '写点什么…')
}

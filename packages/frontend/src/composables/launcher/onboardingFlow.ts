import '@infos/shared/i18n/catalogs/onboarding'
import { configApi } from '../../api/modules/configApi'
import { getApiBaseUrl } from '../../api/transport'
import { t } from '../../i18n'
import { logger } from '../../lib/logger'

export const ONBOARDING_KEY = 'onboarding_completed'
export const ONBOARDING_CHANGED = 'infos:onboarding-changed'
export interface OnboardingFlow {
  version: 2
  runId: string
  stage: 'launcher' | 'desktop' | 'completed'
}
export function onboardingStorageKey() {
  return `infos.onboarding.v2:${getApiBaseUrl()}`
}
function parse(value: string | null | undefined): OnboardingFlow | null {
  if (!value) return null
  try {
    const data = JSON.parse(value) as Partial<OnboardingFlow> | null
    if (
      data?.version === 2 &&
      typeof data.runId === 'string' &&
      ['launcher', 'desktop', 'completed'].includes(data.stage ?? '')
    )
      return data as OnboardingFlow
  } catch {
    /* 旧版用字符串保存完成状态。 */
  }
  return null
}
function cachedFlow(): OnboardingFlow | null {
  try {
    return parse(localStorage.getItem(onboardingStorageKey()))
  } catch {
    return null
  }
}
function cache(flow: OnboardingFlow, notify = true) {
  try {
    localStorage.setItem(onboardingStorageKey(), JSON.stringify(flow))
  } catch {
    /* 本地存储不可用时继续使用服务端进度。 */
  }
  if (notify) window.dispatchEvent(new Event(ONBOARDING_CHANGED))
}
export async function loadOnboardingFlow(): Promise<OnboardingFlow> {
  const local = cachedFlow()
  if (local) return local
  const response = await configApi.get(ONBOARDING_KEY)
  // 请求期间可能已经收到启动器发来的新进度，旧响应不能倒写本地状态。
  const latest = cachedFlow()
  if (latest) return latest
  const value = response.data?.value
  const flow = parse(value)
  if (flow) {
    cache(flow, false)
    return flow
  }
  // 旧用户完成过教程时不强制重播；仍可从启动器主动重新观看。
  return {
    version: 2,
    runId: 'legacy',
    stage: !value || value === 'false' ? 'launcher' : 'completed',
  }
}
async function save(flow: OnboardingFlow): Promise<void> {
  cache(flow)
  try {
    await configApi.set(ONBOARDING_KEY, JSON.stringify(flow))
  } catch (error) {
    logger.warn(
      'Onboarding',
      t('logs.frontend.onboarding', '保存教程进度失败，保留本地进度'),
      error,
    )
  }
}
export async function queueDesktopOnboarding(): Promise<OnboardingFlow> {
  const flow: OnboardingFlow = { version: 2, runId: crypto.randomUUID(), stage: 'desktop' }
  await save(flow)
  return flow
}
export async function completeOnboarding(runId?: string): Promise<void> {
  const current = cachedFlow()
  // 旧窗口的结束回调不能覆盖后来发起的重播。
  if (runId && current && current.runId !== runId) return
  await save({
    version: 2,
    runId: runId ?? current?.runId ?? crypto.randomUUID(),
    stage: 'completed',
  })
}

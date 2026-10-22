export type SocialTurnKind = 'conversation' | 'task'
export const SOCIAL_DELEGATED_TURN_PREFIX = 'social:command:'

/** 恢复回合不等于任务；旧记录仅按稳定的委派标识兼容，不按工具次数或失败状态猜测。 */
export function getSocialTurnKind(record: { id: string; kind?: SocialTurnKind }): SocialTurnKind {
  if (record.kind === 'conversation' || record.kind === 'task') return record.kind
  return record.id.startsWith(SOCIAL_DELEGATED_TURN_PREFIX) ? 'task' : 'conversation'
}

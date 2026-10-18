import type { AgentInputAnswer } from '@infos/shared'

export interface AgentInputDraft {
  signature: string
  answers: AgentInputAnswer[]
  completed: string[]
  index: number
  review: boolean
}
const prefix = 'infos.question-draft.'
const retention = 7 * 24 * 60 * 60_000
let lastPrunedAt = 0

export function readAgentInputDraft(id: string, signature: string): AgentInputDraft | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(prefix + id) || 'null')
    if (
      value?.signature === signature &&
      Date.now() - value.updatedAt < retention &&
      Array.isArray(value.answers) &&
      Array.isArray(value.completed)
    )
      return value
  } catch {
    /* 草稿不可读时从空白回答开始。 */
  }
}

export function saveAgentInputDraft(id: string, draft: AgentInputDraft): void {
  try {
    const existing = localStorage.getItem(prefix + id) !== null
    localStorage.setItem(prefix + id, JSON.stringify({ ...draft, updatedAt: Date.now() }))
    if (existing && Date.now() - lastPrunedAt < 60_000) return
    lastPrunedAt = Date.now()
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix))
    const entries = keys
      .map((key) => {
        try {
          return { key, time: Number(JSON.parse(localStorage.getItem(key) || '{}').updatedAt) || 0 }
        } catch {
          return { key, time: 0 }
        }
      })
      .sort((a, b) => b.time - a.time)
    entries.forEach((entry, index) => {
      if (index >= 30 || Date.now() - entry.time > retention) localStorage.removeItem(entry.key)
    })
  } catch {
    /* 存储不可用不阻止本次问答。 */
  }
}

export function clearAgentInputDraft(id: string): void {
  try {
    localStorage.removeItem(prefix + id)
  } catch {
    /* 不影响提交结果。 */
  }
}

import { apiClient } from '../client'

export type AgentInputStatus = 'pending' | 'answered' | 'skipped' | 'cancelled' | 'interrupted'

export interface AgentInputRequest {
  id: string
  agentId: string
  channel: string
  sessionId: string
  threadId: string
  taskId?: string
  question: string
  context?: string
  options: Array<{ id: string; label: string; description?: string }>
  allowFreeText: boolean
  required: boolean
  status: AgentInputStatus
  selectedOptionIds: string[]
  responseMessage?: string
  createdAt: string
  resolvedAt?: string
}

export const agentInputsApi = {
  list: (
    filter: {
      status?: AgentInputStatus
      agentId?: string
      sessionId?: string
      threadId?: string
    } = {},
  ) => {
    const params = new URLSearchParams()
    if (filter.status) params.set('status', filter.status)
    if (filter.agentId) params.set('agentId', filter.agentId)
    if (filter.sessionId) params.set('sessionId', filter.sessionId)
    if (filter.threadId) params.set('threadId', filter.threadId)
    const query = params.toString()
    return apiClient.get<{ requests: AgentInputRequest[]; total: number }>(
      `/agent-inputs${query ? `?${query}` : ''}`,
    )
  },
}

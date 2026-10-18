import type { TaskPlan } from '@infos/shared'
import { apiClient } from '../client'

export const taskPlansApi = {
  get: (threadId: string, agentId: string) =>
    apiClient.get<TaskPlan | null>(
      `/task-plans/${encodeURIComponent(threadId)}?agentId=${encodeURIComponent(agentId)}`,
    ),
}

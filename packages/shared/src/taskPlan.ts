export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'

export interface PlanStep {
  id: string
  title: string
  status: PlanStepStatus
  task?: { id: string; status: string }
  schedule?: { id: number; status: string; time: string }
}

/** 公开行动清单；完成度仅表示步骤进度，不代表产出通过验收。 */
export interface TaskPlan {
  id: string
  agentId: string
  threadId: string
  taskId: string | null
  revision: number
  title: string
  status: 'active' | 'completed' | 'archived'
  steps: PlanStep[]
  createdAt: string
  updatedAt: string
}

export interface UpdatePlanInput {
  action: 'create' | 'update' | 'get' | 'clear'
  expectedRevision?: number
  title?: string
  steps?: Array<Pick<PlanStep, 'id' | 'title' | 'status'>>
}

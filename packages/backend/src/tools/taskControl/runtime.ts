import type { TaskControlInput, TaskSegmentResult } from '@infos/shared'
export interface TaskToolRuntime {
  control(agentId: string, input: TaskControlInput, threadId?: string): Promise<unknown>
  submitSegment(
    taskId: string,
    executionId: string | undefined,
    result: TaskSegmentResult,
  ): Promise<void>
  beforeTool(
    taskId: string,
    executionId: string | undefined,
    name: string,
    callId: string,
  ): Promise<void>
  afterTool(taskId: string, executionId: string | undefined, callId: string): Promise<void>
}
let runtime: TaskToolRuntime | undefined
export function setTaskToolRuntime(value?: TaskToolRuntime): void {
  runtime = value
}
export function getTaskToolRuntime(): TaskToolRuntime {
  if (!runtime) throw new Error('任务服务尚未初始化')
  return runtime
}
export function optionalTaskToolRuntime(): TaskToolRuntime | undefined {
  return runtime
}

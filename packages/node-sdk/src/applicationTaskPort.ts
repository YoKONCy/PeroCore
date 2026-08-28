import type { ApplicationTaskAccepted, ApplicationTaskSnapshot } from '@infos/shared'

export interface ApplicationTaskSubmitRequest<TInput = unknown> {
  operation: string
  input: TInput
  idempotencyKey: string
  correlationId: string
  causationId?: string
  deadline?: string
}

export interface ApplicationTaskPort {
  submit<TInput = unknown>(
    request: ApplicationTaskSubmitRequest<TInput>,
  ): Promise<ApplicationTaskAccepted>
  get<TResult = unknown>(taskId: string): Promise<ApplicationTaskSnapshot<TResult> | null>
  cancel(taskId: string, reason?: string): Promise<ApplicationTaskSnapshot>
}

export function createApplicationTaskPort(input: {
  submit<TInput>(request: ApplicationTaskSubmitRequest<TInput>): Promise<ApplicationTaskAccepted>
  get<TResult>(taskId: string): Promise<ApplicationTaskSnapshot<TResult> | null>
  cancel(taskId: string, reason?: string): Promise<ApplicationTaskSnapshot>
}): ApplicationTaskPort {
  return Object.freeze({
    submit: <TInput>(request: ApplicationTaskSubmitRequest<TInput>) => input.submit(request),
    get: <TResult>(taskId: string) => input.get<TResult>(taskId),
    cancel: (taskId: string, reason?: string) => input.cancel(taskId, reason),
  })
}

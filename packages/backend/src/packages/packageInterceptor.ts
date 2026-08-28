export type PackageInterceptEvent =
  | 'chat:beforeSend'
  | 'chat:afterReply'
  | 'chat:beforeToolCall'
  | 'chat:afterToolCall'
  | 'memory:beforeCreate'
  | 'memory:afterCreate'
  | 'memory:beforeDelete'
  | 'memory:afterRetrieve'
  | 'agent:onSwitch'
  | 'agent:onMoodChange'
  | 'app:onStart'
  | 'app:onShutdown'

export interface PackageInterceptorContext {
  logger: {
    info(message: string, meta?: Record<string, unknown>): void
    warn(message: string, meta?: Record<string, unknown>): void
    error(message: string, meta?: Record<string, unknown>): void
  }
  abort(reason?: string): void
}

export type PackageInterceptor<T = unknown> = (
  data: T,
  context: PackageInterceptorContext,
) => Promise<T | undefined | void>

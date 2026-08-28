import type {
  PackageInterceptEvent,
  PackageInterceptor,
  PackageInterceptorContext,
} from './packageInterceptor'

interface HookEntry {
  packageId: string
  handler: PackageInterceptor
}

/** Package Policy/Event Contribution 的类型化兼容总线。 */
export class PackageHookBus {
  private readonly hooks = new Map<PackageInterceptEvent, HookEntry[]>()

  register(
    packageId: string,
    event: PackageInterceptEvent,
    handler: PackageInterceptor,
  ): () => void {
    const entries = this.hooks.get(event) ?? []
    const entry = { packageId, handler }
    entries.push(entry)
    this.hooks.set(event, entries)
    return () => {
      const current = this.hooks.get(event)?.filter((item) => item !== entry) ?? []
      if (current.length) this.hooks.set(event, current)
      else this.hooks.delete(event)
    }
  }

  async emitHook<T>(event: string, data: T): Promise<T> {
    let current = data
    let aborted = false
    const context: PackageInterceptorContext = {
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      abort: () => {
        aborted = true
      },
    }
    for (const entry of this.hooks.get(event as PackageInterceptEvent) ?? []) {
      if (aborted) break
      const result = await entry.handler(current, context)
      if (result !== undefined && result !== null) current = result as T
    }
    return current
  }
}

const cancellationCleanups = new WeakMap<AbortSignal, Set<Promise<void>>>()

/** 跟踪取消触发的进程回收，让上层能等到回收完成后再结束任务。 */
export function trackCancellationCleanup(signal: AbortSignal, operation: Promise<void>): void {
  const pending = cancellationCleanups.get(signal) ?? new Set<Promise<void>>()
  cancellationCleanups.set(signal, pending)
  pending.add(operation)
  const remove = () => {
    pending.delete(operation)
  }
  void operation.then(remove, remove)
}

export async function waitForCancellationCleanup(signal: AbortSignal): Promise<void> {
  const pending = cancellationCleanups.get(signal)
  if (pending?.size) await Promise.all([...pending])
}

/** 将父级取消、绝对截止时间与本次耗时预算合并，结束后必须释放监听器。 */
export function createCancellationScope(options: {
  signal?: AbortSignal
  deadline?: string
  timeoutMs?: number
  timeoutMessage?: string
}): { controller: AbortController; signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  let timer: ReturnType<typeof setTimeout> | undefined
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const deadline = options.deadline === undefined ? undefined : Date.parse(options.deadline)
  if (deadline !== undefined && !Number.isFinite(deadline)) {
    controller.abort(new Error('执行截止时间无效'))
  } else {
    const remaining = Math.min(
      options.timeoutMs ?? Infinity,
      deadline === undefined ? Infinity : deadline - Date.now(),
    )
    const expire = () => controller.abort(new Error(options.timeoutMessage ?? '执行已超过截止时间'))
    if (remaining <= 0) expire()
    else if (Number.isFinite(remaining) && !controller.signal.aborted) {
      // 长截止时间分段计时，避免 Node 定时器溢出后立即触发。
      const schedule = (delay: number) => {
        timer = setTimeout(
          () => {
            if (delay > 2_147_483_647) schedule(delay - 2_147_483_647)
            else expire()
          },
          Math.min(delay, 2_147_483_647),
        )
        timer.unref?.()
      }
      schedule(remaining)
    }
  }
  return {
    controller,
    signal: controller.signal,
    dispose() {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    },
  }
}

/** 等待期间响应取消；底层操作仍须使用同一信号完成资源回收。 */
export function waitWithSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new Error('执行已取消'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    // 即使取消已经发生，也接住底层操作的后续失败，避免未处理的拒绝。
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) abort()
        else resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

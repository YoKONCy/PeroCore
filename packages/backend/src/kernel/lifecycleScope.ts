/**
 * 进程内逻辑微内核的结构化生命周期作用域。
 *
 * 作用域按注册逆序释放资源；父作用域释放时会等待所有子资源停稳。
 */
export class LifecycleScope {
  private readonly disposers: Array<() => void | Promise<void>> = []
  private disposePromise: Promise<void> | null = null
  private closed = false

  constructor(readonly name: string) {}

  get isClosed(): boolean {
    return this.closed
  }

  /** 注册资源释放函数，返回可提前撤销该项的幂等函数。 */
  defer(disposer: () => void | Promise<void>): () => Promise<void> {
    if (this.closed) throw new Error(`生命周期作用域已关闭: ${this.name}`)
    let active = true
    const owned = async () => {
      if (!active) return
      active = false
      await disposer()
    }
    this.disposers.push(owned)
    return owned
  }

  /** 创建由当前作用域拥有的子作用域。 */
  child(name: string): LifecycleScope {
    const child = new LifecycleScope(`${this.name}/${name}`)
    this.defer(() => child.dispose())
    return child
  }

  /** 逆序释放全部资源；并发调用共享同一个完成边界。 */
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.closed = true
    this.disposePromise = this.disposeAll()
    return this.disposePromise
  }

  private async disposeAll(): Promise<void> {
    const errors: unknown[] = []
    for (let index = this.disposers.length - 1; index >= 0; index -= 1) {
      try {
        await this.disposers[index]!()
      } catch (error) {
        errors.push(error)
      }
    }
    this.disposers.length = 0
    if (errors.length) throw new AggregateError(errors, `释放生命周期作用域失败: ${this.name}`)
  }
}

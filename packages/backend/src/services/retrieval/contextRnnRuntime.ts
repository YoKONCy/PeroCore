import type { ContextRnn } from './contextRnn'
import {
  isContextRnnEnabled,
  isContextRnnFeedbackEnabled,
  type MemoryRuntimeConfig,
} from '../memory/memoryRuntimeConfig'

/** 只在实际检索使用时创建 RNN；配置代次阻止关闭后迟到的检索或反馈重新启用它。 */
export class ContextRnnRuntime {
  private instance?: ContextRnn
  private enabled = false
  private feedback = false
  private closed = false
  private revision = 0

  constructor(private readonly create: () => ContextRnn) {}

  get generation(): number {
    return this.revision
  }

  get feedbackEnabled(): boolean {
    return !this.closed && this.enabled && this.feedback
  }
  get hasPendingChanges(): boolean {
    return !this.closed && this.enabled && !!this.instance?.hasDirtyChanges
  }

  configure(advanced: MemoryRuntimeConfig['advanced']): void {
    if (this.closed) return
    const enabled = isContextRnnEnabled(advanced)
    const feedback = isContextRnnFeedbackEnabled(advanced)
    if (enabled !== this.enabled || feedback !== this.feedback) this.revision++
    this.enabled = enabled
    this.feedback = feedback
    if (!enabled && this.instance) {
      // 关闭边界只落盘尚未保存的变更，然后释放全部权重与隐状态引用。
      this.instance.saveAll()
      this.instance = undefined
    }
  }

  acquire(generation: number): ContextRnn | undefined {
    if (this.closed || !this.enabled || generation !== this.generation) return undefined
    return (this.instance ??= this.create())
  }

  peek(generation: number): ContextRnn | undefined {
    if (this.closed || !this.enabled || generation !== this.generation) return undefined
    return this.instance
  }

  checkpoint(): void {
    if (this.hasPendingChanges) this.instance?.saveAll()
  }

  /** 删除使所有在途反馈失效，释放隐状态引用而不再次保存迟到学习结果。 */
  invalidate(): void {
    this.revision++
    this.instance = undefined
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.enabled = false
    this.feedback = false
    this.revision++
    this.instance?.saveAll()
    this.instance = undefined
  }
}

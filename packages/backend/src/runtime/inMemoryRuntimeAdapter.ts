import type {
  KernelCallContext,
  KernelObjectRef,
  RuntimeAdapter,
  RuntimeAdapterRequest,
  RuntimeAdapterResult,
  RuntimeIdentity,
  RuntimeSnapshot,
} from '@infos/shared'
import { assertKernelDeadline } from '../kernel/kernelEnvelope'

/** 用于验证 RuntimeAdapter 契约的确定性内存 Runtime。 */
export class InMemoryRuntimeAdapter<
  TState extends Record<string, unknown>,
> implements RuntimeAdapter<TState> {
  private generation: number
  private readonly cancelled = new Set<string>()

  constructor(
    private readonly instance: KernelObjectRef,
    private state: TState,
  ) {
    this.generation = instance.generation
  }

  async getIdentity(): Promise<RuntimeIdentity> {
    return {
      runtimeType: this.instance.objectType,
      instance: this.currentRef(),
      provider: 'memory',
    }
  }

  async inspect(target: KernelObjectRef): Promise<RuntimeSnapshot<TState>> {
    this.assertTarget(target)
    return {
      runtime: this.currentRef(),
      generation: this.generation,
      capturedAt: new Date().toISOString(),
      state: structuredClone(this.state),
    }
  }

  async execute<TInput = unknown, TOutput = unknown>(
    request: RuntimeAdapterRequest<TInput>,
    context: KernelCallContext,
  ): Promise<RuntimeAdapterResult<TOutput>> {
    assertKernelDeadline(context)
    this.assertTarget(request.target)
    if (request.expectedGeneration !== this.generation) {
      throw new Error('RUNTIME_STALE_HANDLE: Runtime generation 已变化')
    }
    if (this.cancelled.delete(request.callId)) throw new Error('RUNTIME_CALL_CANCELLED: 调用已取消')
    if (request.operation === 'replace') {
      this.state = structuredClone(request.input as unknown) as TState
      this.generation += 1
    } else if (request.operation === 'merge') {
      this.state = { ...this.state, ...(request.input as Record<string, unknown>) }
    } else {
      throw new Error(`RUNTIME_OPERATION_UNSUPPORTED: ${request.operation}`)
    }
    return {
      callId: request.callId,
      target: this.currentRef(),
      generation: this.generation,
      output: structuredClone(this.state) as unknown as TOutput,
      verification: { inspectedGeneration: this.generation },
    }
  }

  async cancel(callId: string): Promise<void> {
    this.cancelled.add(callId)
  }

  private currentRef(): KernelObjectRef {
    return { ...this.instance, generation: this.generation }
  }

  private assertTarget(target: KernelObjectRef): void {
    if (
      target.objectType !== this.instance.objectType ||
      target.objectId !== this.instance.objectId
    ) {
      throw new Error('RUNTIME_TARGET_MISMATCH: Runtime 对象不匹配')
    }
  }
}

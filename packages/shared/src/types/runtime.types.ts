/**
 * runtime.types — 跨包共享协议层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type { KernelCallContext, KernelObjectRef } from './kernel.types'

export interface RuntimeIdentity {
  runtimeType: string
  instance: KernelObjectRef
  provider: string
}

export interface RuntimeStableHandle {
  ref: KernelObjectRef
  locator?: Readonly<Record<string, unknown>>
}

export interface RuntimeSnapshot<TState = unknown> {
  runtime: KernelObjectRef
  generation: number
  capturedAt: string
  state: TState
  handles?: readonly RuntimeStableHandle[]
}

export interface RuntimeAdapterRequest<TInput = unknown> {
  callId: string
  target: KernelObjectRef
  operation: string
  input: TInput
  expectedGeneration: number
}

export interface RuntimeAdapterResult<TOutput = unknown> {
  callId: string
  target: KernelObjectRef
  generation: number
  output: TOutput
  verification?: Readonly<Record<string, unknown>>
}

export interface RuntimeAdapter<TState = unknown> {
  getIdentity(): Promise<RuntimeIdentity>
  inspect(target: KernelObjectRef): Promise<RuntimeSnapshot<TState>>
  execute<TInput = unknown, TOutput = unknown>(
    request: RuntimeAdapterRequest<TInput>,
    context: KernelCallContext,
  ): Promise<RuntimeAdapterResult<TOutput>>
  cancel(callId: string): Promise<void>
}

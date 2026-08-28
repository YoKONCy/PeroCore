/**
 * executionContext — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { KernelExecutionDescriptor } from '@infos/shared'

interface KernelExecutionScope {
  descriptor: KernelExecutionDescriptor
  consume?: (usage: {
    llmCalls?: number
    inputTokens?: number
    outputTokens?: number
    toolCalls?: number
  }) => void
}

const executionScope = new AsyncLocalStorage<KernelExecutionScope>()

/** 在当前异步调用链绑定唯一Kernel Execution。 */
export function runWithKernelExecution<T>(
  descriptor: KernelExecutionDescriptor,
  run: () => T,
  consume?: KernelExecutionScope['consume'],
): T {
  return executionScope.run({ descriptor, consume }, run)
}

/** 深层Repository/Port读取当前Execution；没有执行上下文时返回undefined。 */
export function currentKernelExecution(): KernelExecutionDescriptor | undefined {
  return executionScope.getStore()?.descriptor
}

export function consumeCurrentKernelExecution(usage: {
  llmCalls?: number
  inputTokens?: number
  outputTokens?: number
  toolCalls?: number
}): boolean {
  const consume = executionScope.getStore()?.consume
  if (!consume) return false
  consume(usage)
  return true
}

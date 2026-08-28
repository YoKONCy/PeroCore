import type { KernelCallContext, KernelNodeId } from '@infos/shared'
import type { BuiltinTool } from '../index'
import type {
  RemoteShellCapabilityRuntime,
  RemoteShellOperation,
} from '../../capabilities/remoteShellCapabilityRuntime'
import { toolSuccess } from '../../services/execution/toolResult'

let runtime: RemoteShellCapabilityRuntime | null = null

export function setRemoteShellCapabilityRuntime(value: RemoteShellCapabilityRuntime): void {
  runtime = value
}

function operationTool(name: string, operation: RemoteShellOperation): BuiltinTool {
  return {
    name,
    async execute(args, ctx) {
      if (!runtime) throw new Error('远程 Shell Capability Runtime 尚未初始化')
      if (!ctx.approvedSensitiveAction) throw new Error('远程终端调用缺少当前模式授权凭证')
      const nodeId = String(args.node_id ?? '').trim() as KernelNodeId
      if (!nodeId) throw new Error('node_id 不能为空')
      const input = { ...args }
      delete input.node_id
      const context: KernelCallContext = {
        principalId: ctx.agentId,
        correlationId: ctx.toolCallId ?? `remote-terminal:${name}:${Date.now()}`,
        executionId: ctx.executionId,
        processId: ctx.processId,
        deadline: ctx.deadline,
      }
      const result = await runtime.invoke(nodeId, operation, input, context)
      return toolSuccess(JSON.stringify(result), { nodeId })
    },
  }
}

export const remoteTerminalNodesTool: BuiltinTool = {
  name: 'remote_terminal_nodes',
  async execute() {
    if (!runtime) throw new Error('远程 Shell Capability Runtime 尚未初始化')
    return toolSuccess(JSON.stringify(runtime.listNodes()))
  },
}

export const remoteTerminalCreateTool = operationTool('remote_terminal_create', 'create')
export const remoteTerminalListTool = operationTool('remote_terminal_list', 'list')
export const remoteTerminalGetTool = operationTool('remote_terminal_get', 'get')
export const remoteTerminalReadTool = operationTool('remote_terminal_read', 'read')
export const remoteTerminalWaitTool = operationTool('remote_terminal_wait', 'wait')
export const remoteTerminalWriteTool = operationTool('remote_terminal_write', 'write')
export const remoteTerminalInterruptTool = operationTool('remote_terminal_interrupt', 'interrupt')
export const remoteTerminalKillTool = operationTool('remote_terminal_kill', 'kill')
export const remoteTerminalCloseTool = operationTool('remote_terminal_close', 'close')

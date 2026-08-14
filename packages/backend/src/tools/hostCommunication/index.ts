import type { BuiltinTool } from '../index'

export const communicateWithHostTool: BuiltinTool = {
  name: 'communicate_with_host',
  async execute() {
    return JSON.stringify({
      success: false,
      error: '此系统协议工具只能在 AgentApplication 的 SubAgent 运行时中调用',
    })
  },
}

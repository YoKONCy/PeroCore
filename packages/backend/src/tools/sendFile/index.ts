import { z } from 'zod'
import type { BuiltinTool } from '../index'
import type { ResourceService } from '../../services/attachment/resourceService'
import { toolSuccess } from '../../services/execution/toolResult'

const inputSchema = z.object({
  source: z.string().trim().min(1).max(2048),
  caption: z.string().trim().max(300).optional(),
})
let resources: ResourceService | undefined
export function setResourceService(service: ResourceService): void {
  resources = service
}

export const sendFileTool: BuiltinTool = {
  name: 'send_file',
  allowedSources: ['desktop', 'companion', 'group'],
  async execute(args, context) {
    if (!resources) throw new Error('资源服务未初始化')
    const input = inputSchema.parse(args)
    const { resource } = await resources.prepare(context, input.source, input.caption)
    return toolSuccess(
      JSON.stringify({ success: true, resource, reference: `attachment:${resource.id}` }),
    )
  },
}

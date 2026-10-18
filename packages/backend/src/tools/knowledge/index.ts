import type { BuiltinTool } from '../index'
import type { KnowledgeService } from '../../services/knowledge/knowledgeService'
import { knowledgeSearchSchema } from '../../services/knowledge/knowledgeValidation'

let knowledge: KnowledgeService | null = null
export function setKnowledgeToolDeps(service: KnowledgeService): void {
  knowledge = service
}

export const searchKnowledgeTool: BuiltinTool = {
  name: 'search_knowledge',
  async execute(args, ctx) {
    if (!knowledge) throw new Error('文档知识库未初始化')
    const parsed = knowledgeSearchSchema.safeParse({
      ...args,
      partIds: args.part_ids,
      documentId: args.document_id,
    })
    if (!parsed.success)
      throw new Error(parsed.error.issues.map((issue) => issue.message).join('；'))
    const result = await knowledge.index.search(parsed.data, ctx.signal)
    return {
      ok: true,
      output: JSON.stringify(result),
      truncated: result.truncated,
      metadata: { sourceRef: 'knowledge://documents', hash: result.version },
    }
  },
}

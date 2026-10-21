import type { BuiltinTool } from '../index'
import type { DocumentService } from '../../services/document/documentService'
import { toolFailure, toolSuccess } from '../../services/execution/toolResult'
import { ZodError } from 'zod'

let service: DocumentService | undefined
export function setDocumentService(value: DocumentService): void {
  service = value
}

export const documentTool: BuiltinTool = {
  name: 'document',
  allowedSources: ['desktop', 'companion'],
  async execute(args, context) {
    if (context.interactionMode !== 'work')
      return toolFailure('DOCUMENT_WORK_ONLY', '文档工具仅在工作模式开放')
    if (!service) return toolFailure('DOCUMENT_UNAVAILABLE', '文档服务未就绪')
    try {
      return toolSuccess(JSON.stringify(await service.execute(args, context)))
    } catch (error) {
      if (error instanceof ZodError)
        return toolFailure(
          'DOCUMENT_INVALID_INPUT',
          `文档参数无效：${error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join('.') || '参数'} ${issue.message}`)
            .join('；')}`,
        )
      if (context.signal?.aborted) return toolFailure('DOCUMENT_CANCELLED', '文档操作已取消')
      return toolFailure('DOCUMENT_FAILED', error instanceof Error ? error.message : '文档处理失败')
    }
  },
}

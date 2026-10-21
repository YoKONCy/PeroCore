import type {
  DocumentPdfRequest,
  DocumentPdfResponse,
  KernelCallContext,
  KernelCapabilityRequirement,
  KernelNodeId,
} from '@infos/shared'
import { DOCUMENT_MAX_HTML_BYTES, DOCUMENT_MAX_OUTPUT_BYTES } from '@infos/shared'
import type { CapabilityDirectory } from '../kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '../kernel/capabilityHandleRegistry'
import { LifecycleScope } from '../kernel/lifecycleScope'

const REQUIREMENT: KernelCapabilityRequirement = {
  requirementId: 'kernel.document-export',
  capabilityType: 'document.render',
  contractVersion: '1.0',
  operations: ['renderPdf'],
  required: false,
  binding: 'lazy',
  cardinality: 'one',
}

/** 只在显式选择 Chromium 时申请在线渲染节点，通用导出不依赖客户端在线。 */
export class DocumentPdfCapabilityRuntime {
  constructor(
    private readonly directory: CapabilityDirectory,
    private readonly handles: CapabilityHandleRegistry,
    private readonly localNodeId: KernelNodeId,
  ) {}

  available(): boolean {
    return this.directory.listOffers(REQUIREMENT).some((offer) => offer.health === 'available')
  }

  async render(
    input: DocumentPdfRequest,
    context: KernelCallContext,
    signal: AbortSignal,
  ): Promise<Buffer> {
    if (Buffer.byteLength(input.html) > DOCUMENT_MAX_HTML_BYTES)
      throw new Error('Chromium 文档超过 4MB，请用 PDFKit 或减少图片')
    const offer = this.directory
      .listOffers(REQUIREMENT)
      .find((candidate) => candidate.health === 'available')
    if (!offer) throw new Error('Chromium PDF 渲染不可用，请连接 Electron 或改用 pdfkit')
    const scope = new LifecycleScope('document-pdf-render')
    try {
      const handle = this.handles.issue({
        subjectId: context.principalId,
        issuerNodeId: this.localNodeId,
        subjectNodeId: this.localNodeId,
        providerNodeId: offer.placement?.providerNodeId,
        revocationEpoch: 1,
        resource: offer.provider,
        operations: ['renderPdf'],
        scope: { capabilityType: 'document.render' },
        revocable: true,
      })
      scope.defer(() => {
        this.handles.revoke(handle.handleId)
      })
      const port = this.directory.bind({
        requirement: {
          ...REQUIREMENT,
          ...(offer.placement
            ? { placement: { preferredNodeId: offer.placement.providerNodeId } }
            : {}),
        },
        handleId: handle.handleId,
        scope,
        principalId: context.principalId,
      })
      const output = await port.invoke<DocumentPdfRequest, DocumentPdfResponse>(
        'renderPdf',
        input,
        context,
        signal,
      )
      signal.throwIfAborted()
      if (
        output?.mimeType !== 'application/pdf' ||
        typeof output.base64 !== 'string' ||
        output.base64.length > Math.ceil(DOCUMENT_MAX_OUTPUT_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(output.base64)
      )
        throw new Error('渲染节点返回的 PDF 数据无效')
      const bytes = Buffer.from(output.base64, 'base64')
      if (bytes.length > DOCUMENT_MAX_OUTPUT_BYTES || bytes.subarray(0, 5).toString() !== '%PDF-')
        throw new Error('渲染节点返回的文件不是有效 PDF 或超过 20MB')
      return bytes
    } finally {
      await scope.dispose()
    }
  }
}

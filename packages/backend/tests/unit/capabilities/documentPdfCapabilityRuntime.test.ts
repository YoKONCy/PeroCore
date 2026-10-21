import { describe, expect, it, vi } from 'vitest'
import { DocumentPdfCapabilityRuntime } from '@infos/backend/capabilities/documentPdfCapabilityRuntime'
import { DOCUMENT_RENDER_CAPABILITY } from '@infos/backend/capabilities/nativeCapabilityDefinitions'
import { CapabilityDirectory } from '@infos/backend/kernel/capabilityDirectory'
import { CapabilityHandleRegistry } from '@infos/backend/kernel/capabilityHandleRegistry'
import type { KernelCapabilityOffer, KernelNodeId } from '@infos/shared'

function setup(output?: unknown) {
  const handles = new CapabilityHandleRegistry()
  const revoke = vi.spyOn(handles, 'revoke')
  const directory = new CapabilityDirectory(handles)
  directory.registerDefinition(DOCUMENT_RENDER_CAPABILITY)
  const offer: KernelCapabilityOffer = {
    offerId: 'document-test',
    capabilityType: 'document.render',
    contractVersion: '1.0',
    operations: ['renderPdf'],
    resourceKinds: ['pdf'],
    health: 'available',
    provider: {
      objectType: 'capability-provider',
      objectId: 'document-test' as never,
      generation: 1,
      ownerPrincipalId: 'system',
    },
  }
  const provider = vi.fn(async (_envelope: unknown) => output)
  const unregister =
    output === undefined ? () => undefined : directory.registerProvider(offer, provider)
  return {
    runtime: new DocumentPdfCapabilityRuntime(directory, handles, 'local' as KernelNodeId),
    provider,
    revoke,
    unregister,
  }
}

const input = { html: '<h1>文稿</h1>', paper: 'A4' as const, landscape: false, marginMm: 18 }
const context = { principalId: 'pero', correlationId: 'document-test' }

describe('Chromium 文档渲染能力', () => {
  it('节点离线时不宣称可用，也不使用桌面操作入口兜底', async () => {
    const { runtime, provider } = setup()
    expect(runtime.available()).toBe(false)
    await expect(runtime.render(input, context, new AbortController().signal)).rejects.toThrow(
      '不可用',
    )
    expect(provider).not.toHaveBeenCalled()
  })

  it('通过受控能力调用返回 PDF，并释放本次句柄', async () => {
    const bytes = Buffer.from('%PDF-1.7\n%%EOF')
    const { runtime, provider, revoke, unregister } = setup({
      mimeType: 'application/pdf',
      base64: bytes.toString('base64'),
    })
    expect(runtime.available()).toBe(true)
    expect(await runtime.render(input, context, new AbortController().signal)).toEqual(bytes)
    expect(provider.mock.calls[0]?.[0]).toMatchObject({
      operation: 'document.render/renderPdf',
      payload: { operation: 'renderPdf', input },
    })
    expect(revoke).toHaveBeenCalledTimes(1)
    unregister()
    expect(runtime.available()).toBe(false)
  })

  it('拒绝伪装成 PDF 的结果，失败也释放授权', async () => {
    const { runtime, revoke } = setup({
      mimeType: 'application/pdf',
      base64: Buffer.from('<html>错误页</html>').toString('base64'),
    })
    await expect(runtime.render(input, context, new AbortController().signal)).rejects.toThrow(
      '有效 PDF',
    )
    expect(revoke).toHaveBeenCalledTimes(1)
  })
})

import type {
  AutomaticApprovalRecord,
  FileWritePreviewBaseline,
  ToolCallSurfaceProps,
  ToolResultSurfaceProps,
} from '@infos/shared'

/** 直接调用与 NIT 子调用共用同一套工具卡片数据。 */
export interface ToolCallView {
  callId?: string
  automaticApproval?: AutomaticApprovalRecord
  name: string
  args: string
  result?: string
  isError?: boolean
  durationMs?: number
  receivedChars?: number
  assembling?: boolean
  interrupted?: boolean
  fileBaseline?: FileWritePreviewBaseline
  previewTruncated?: boolean
}

export function toolCallView(
  call: ToolCallSurfaceProps,
  result?: ToolResultSurfaceProps,
  ended = false,
): ToolCallView {
  return {
    callId: call.callId,
    name: call.name || 'assembling_tool',
    args: call.args || call.argsPreview || '',
    result: result?.result,
    isError: result?.isError,
    durationMs: result?.durationMs,
    automaticApproval: result?.automaticApproval,
    receivedChars: call.receivedChars,
    assembling: call.state === 'assembling',
    interrupted: !result && (call.state === 'failed' || ended),
    fileBaseline: call.fileBaseline,
    previewTruncated: call.previewTruncated,
  }
}

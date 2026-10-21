/** 文档能力的跨端约定；格式转换与成果交付分别处理。 */
export const DOCUMENT_MAX_INPUT_BYTES = 20 * 1024 * 1024
export const DOCUMENT_MAX_OUTPUT_BYTES = 20 * 1024 * 1024
export const DOCUMENT_MAX_HTML_BYTES = 4 * 1024 * 1024
export const DOCUMENT_OFFICE_EXTENSIONS = [
  'doc',
  'docx',
  'docm',
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'ppt',
  'pptx',
  'pptm',
  'pps',
  'ppsx',
  'ppsm',
  'pot',
  'odt',
  'ods',
  'odp',
  'rtf',
  'epub',
] as const

export function isOfficeDocumentName(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase()
  return DOCUMENT_OFFICE_EXTENSIONS.some((item) => item === extension)
}

export interface DocumentPdfRequest {
  html: string
  paper: 'A4' | 'Letter'
  landscape: boolean
  marginMm: number
}

export interface DocumentPdfResponse {
  mimeType: 'application/pdf'
  base64: string
}

export type WorkspacePreviewKind = 'text' | 'image' | 'svg' | 'pdf' | 'audio' | 'video' | 'file'

export interface WorkspaceFileDescriptor {
  path: string
  name: string
  kind: WorkspacePreviewKind
  mimeType: string
  sizeBytes: number
  modifiedAt: string
  version: string
}

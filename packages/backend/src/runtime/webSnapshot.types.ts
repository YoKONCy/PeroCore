export interface WebElementSnapshot {
  handle: string
  role: string
  name: string
  tag: string
  disabled: boolean
  checked?: boolean
  value?: string
  inputType?: string
  required?: boolean
  parentFormHandle?: string
  label?: string
  frameId?: string
  backendNodeId?: number
  bounds?: { x: number; y: number; width: number; height: number }
}

export interface WebFrameSnapshot {
  id: string
  parentId?: string
  url: string
  name?: string
}

export interface WebPageSnapshot {
  snapshotId: string
  contentHash: string
  structureHash: string
  url: string
  title: string
  text: string
  hiddenText?: string
  markdown: string
  elements: WebElementSnapshot[]
  frames: WebFrameSnapshot[]
  accessibility: Array<{ role: string; name: string; value?: string; disabled?: boolean }>
  viewport: { width: number; height: number; scrollX: number; scrollY: number }
  blocked?: string
}

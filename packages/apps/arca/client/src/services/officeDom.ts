import { normalizeRuns, type OfficeMarks, type OfficeRun } from '@infos/document-engine/office'

export function readOfficeRuns(root: Node, inherited: OfficeMarks = {}): OfficeRun[] {
  const result: OfficeRun[] = []
  const visit = (node: Node, marks: OfficeMarks) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) result.push({ text: node.textContent, marks })
      return
    }
    if (node instanceof HTMLElement) {
      if (node.tagName === 'BR') {
        if (!node.hasAttribute('data-office-placeholder')) result.push({ text: '\n', marks })
        return
      }
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName)) return
      marks = { ...marks }
      if (['B', 'STRONG'].includes(node.tagName)) marks.bold = true
      if (['I', 'EM'].includes(node.tagName)) marks.italic = true
      if (node.tagName === 'U') marks.underline = true
      if (['S', 'DEL', 'STRIKE'].includes(node.tagName)) marks.strike = true
      if (node.tagName === 'CODE') marks.code = true
      if (node.tagName === 'A') marks.link = node.getAttribute('href') ?? undefined
      const source = node.dataset.officeMarks
      if (source) {
        try {
          Object.assign(marks, JSON.parse(source))
        } catch {
          /* 不采纳损坏的格式标记。 */
        }
      }
    }
    for (const child of node.childNodes) visit(child, marks)
  }
  visit(root, inherited)
  return normalizeRuns(result)
}
export function officeFragment(runs: OfficeRun[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const run of normalizeRuns(runs)) {
    const span = document.createElement('span'),
      marks = run.marks ?? {}
    span.dataset.officeMarks = JSON.stringify(marks)
    span.style.fontWeight = marks.bold ? '700' : ''
    span.style.fontStyle = marks.italic ? 'italic' : ''
    span.style.textDecoration = [
      marks.underline ? 'underline' : '',
      marks.strike ? 'line-through' : '',
    ]
      .filter(Boolean)
      .join(' ')
    span.style.fontFamily = marks.code ? 'var(--arca-font-code)' : (marks.fontFamily ?? '')
    if (marks.fontSize) span.style.fontSize = `${marks.fontSize}pt`
    if (marks.color) span.style.color = marks.color
    if (marks.highlight) span.style.backgroundColor = marks.highlight
    if (marks.link) {
      span.title = marks.link
      span.style.textDecoration = 'underline'
    }
    span.textContent = run.text
    if (marks.citation) {
      const sup = document.createElement('sup')
      sup.append(span)
      const link = document.createElement('a')
      link.href = `#reference-${marks.citation}`
      link.title = '查看参考资料与脚注'
      link.append(sup)
      fragment.append(link)
      continue
    }
    if (marks.link) {
      const link = document.createElement('a')
      link.href = marks.link
      link.target = '_blank'
      if (marks.link.startsWith('#')) link.target = '_self'
      link.rel = 'noopener noreferrer'
      link.append(span)
      fragment.append(link)
    } else fragment.append(span)
  }
  if (!fragment.childNodes.length) {
    const br = document.createElement('br')
    br.dataset.officePlaceholder = ''
    fragment.append(br)
  }
  return fragment
}
export function pointOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(node, offset)
  return readOfficeRuns(range.cloneContents())
    .map((run) => run.text)
    .join('').length
}
export function focusOfficeNode(id: string, offset: number): void {
  const root = document.querySelector<HTMLElement>(`[data-office-editable="${CSS.escape(id)}"]`)
  if (!root) return
  root.focus({ preventScroll: true })
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null,
    remaining = offset
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= length
  }
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
export function captureOfficeSelection():
  | { anchor: { nodeId: string; offset: number }; focus: { nodeId: string; offset: number } }
  | undefined {
  const selected = window.getSelection()
  if (!selected?.anchorNode || !selected.focusNode) return undefined
  const root = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
      '[data-office-editable]',
    )
  const anchor = root(selected.anchorNode),
    focus = root(selected.focusNode)
  if (!anchor || !focus) return undefined
  return {
    anchor: {
      nodeId: anchor.dataset.officeEditable!,
      offset: pointOffset(anchor, selected.anchorNode, selected.anchorOffset),
    },
    focus: {
      nodeId: focus.dataset.officeEditable!,
      offset: pointOffset(focus, selected.focusNode, selected.focusOffset),
    },
  }
}
export function restoreOfficeSelection(
  selected: NonNullable<ReturnType<typeof captureOfficeSelection>>,
): void {
  const point = (value: typeof selected.anchor): { node: Node; offset: number } | undefined => {
    const root = document.querySelector<HTMLElement>(
      `[data-office-editable="${CSS.escape(value.nodeId)}"]`,
    )
    if (!root) return undefined
    let remaining = value.offset,
      node: Node | null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0
      if (remaining <= length) return { node, offset: remaining }
      remaining -= length
    }
    return { node: root, offset: root.childNodes.length }
  }
  const anchor = point(selected.anchor),
    focus = point(selected.focus)
  if (anchor && focus)
    window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
}

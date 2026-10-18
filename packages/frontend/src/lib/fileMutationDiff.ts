export interface FileDiffRow {
  kind: 'context' | 'remove' | 'add'
  oldLine?: number
  newLine?: number
  text: string
}

export function fileTextLines(text: string): string[] {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** 限制对齐计算量；大段重写采用前后缀收缩，避免流式更新阻塞输入。 */
export function fileMutationDiff(oldText: string, newText: string): FileDiffRow[] {
  const oldLines = fileTextLines(oldText)
  const newLines = fileTextLines(newText)
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix++
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  )
    suffix++
  const rows: FileDiffRow[] = []
  for (let i = Math.max(0, prefix - 2); i < prefix; i++)
    rows.push({ kind: 'context', oldLine: i + 1, newLine: i + 1, text: oldLines[i]! })
  const oldEnd = oldLines.length - suffix
  const newEnd = newLines.length - suffix
  const oldCount = oldEnd - prefix
  const newCount = newEnd - prefix
  if (oldCount * newCount <= 180_000 && oldCount > 0 && newCount > 0) {
    const width = newCount + 1
    const table = new Uint32Array((oldCount + 1) * width)
    for (let i = oldCount - 1; i >= 0; i--) {
      for (let j = newCount - 1; j >= 0; j--) {
        table[i * width + j] =
          oldLines[prefix + i] === newLines[prefix + j]
            ? table[(i + 1) * width + j + 1]! + 1
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < oldCount || j < newCount) {
      if (i < oldCount && j < newCount && oldLines[prefix + i] === newLines[prefix + j]) {
        rows.push({
          kind: 'context',
          oldLine: prefix + i + 1,
          newLine: prefix + j + 1,
          text: oldLines[prefix + i]!,
        })
        i++
        j++
      } else if (
        i < oldCount &&
        (j === newCount || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
      ) {
        rows.push({ kind: 'remove', oldLine: prefix + i + 1, text: oldLines[prefix + i++]! })
      } else {
        rows.push({ kind: 'add', newLine: prefix + j + 1, text: newLines[prefix + j++]! })
      }
    }
  } else {
    for (let i = prefix; i < oldEnd; i++)
      rows.push({ kind: 'remove', oldLine: i + 1, text: oldLines[i]! })
    for (let i = prefix; i < newEnd; i++)
      rows.push({ kind: 'add', newLine: i + 1, text: newLines[i]! })
  }
  for (let i = 0; i < Math.min(2, suffix); i++)
    rows.push({
      kind: 'context',
      oldLine: oldEnd + i + 1,
      newLine: newEnd + i + 1,
      text: oldLines[oldEnd + i]!,
    })
  return rows
}

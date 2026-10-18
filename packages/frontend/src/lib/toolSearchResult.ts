export interface ToolSearchRow {
  file: string
  kind: 'file' | 'directory'
  line?: number
  column?: number
  content?: string
}

export interface ToolSearchResult {
  rows: ToolSearchRow[]
  fileCount: number
  directoryCount: number
  matchCount?: number
  truncated: boolean
  previewTruncated: boolean
  auditOnly: boolean
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function paths(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
    : []
}

/** 兼容旧路径数组、文件搜索结果、正文匹配及只保留数量的历史审计。 */
export function parseToolSearchResult(raw?: string): ToolSearchResult | undefined {
  if (raw === undefined) return
  try {
    const value: unknown = JSON.parse(raw)
    const data: Record<string, unknown> = Array.isArray(value)
      ? { files: value }
      : value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {}
    const base = {
      truncated: data.truncated === true,
      previewTruncated: data.previewTruncated === true,
      auditOnly: false,
    }
    if (Array.isArray(data.files)) {
      const files = paths(data.files)
      const directories = paths(data.directories)
      return {
        ...base,
        rows: [
          ...files.map((file): ToolSearchRow => ({ file, kind: 'file' })),
          ...directories.map((file): ToolSearchRow => ({ file, kind: 'directory' })),
        ],
        fileCount: count(data.count) ?? files.length,
        directoryCount: count(data.directoryCount) ?? directories.length,
      }
    }
    if (Array.isArray(data.matches)) {
      const rows: ToolSearchRow[] = []
      for (const entry of data.matches) {
        if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') continue
        rows.push({
          file: entry.file,
          kind: 'file',
          line: count(entry.line),
          column: count(entry.column),
          content: typeof entry.content === 'string' ? entry.content : undefined,
        })
      }
      return {
        ...base,
        rows,
        fileCount: count(data.fileCount) ?? new Set(rows.map((row) => row.file)).size,
        directoryCount: 0,
        matchCount: count(data.total) ?? rows.length,
      }
    }
    if (
      data.kind === 'tool_result_audit' &&
      data.toolName === 'code_search' &&
      count(data.fileCount) !== undefined
    ) {
      return {
        ...base,
        rows: [],
        fileCount: count(data.fileCount)!,
        directoryCount: 0,
        matchCount: count(data.total),
        auditOnly: true,
      }
    }
  } catch {
    // 旧的截断文本无法可靠计数，保持未知，不能误报为零。
  }
}

export function toolSearchSummary(result: ToolSearchResult): string {
  const counts = [`${result.fileCount} 个文件`]
  if (result.directoryCount) counts.push(`${result.directoryCount} 个目录`)
  if (result.matchCount !== undefined) counts.push(`${result.matchCount} 处匹配`)
  return `找到${result.truncated ? '至少 ' : ' '}${counts.join(' · ')}`
}

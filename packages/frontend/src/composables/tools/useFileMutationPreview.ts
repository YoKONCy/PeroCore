import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { parseStreamingToolArguments, type FileWritePreviewBaseline } from '@infos/shared'
import { fileMutationDiff, fileTextLines, type FileDiffRow } from '../../lib/fileMutationDiff'

export interface FileMutationPreviewSource {
  args: string
  result?: string
  toolName?: string
  assembling?: boolean
  interrupted?: boolean
  isError?: boolean
  fileBaseline?: FileWritePreviewBaseline
}

function parseResult(raw?: string): Record<string, unknown> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : undefined
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** 折叠摘要与展开轨道共用一次 Diff；未获得旧文时明确保留未知状态。 */
export function fileMutationPreview(source: FileMutationPreviewSource) {
  const parsed = parseStreamingToolArguments(source.args)
  const args = parsed.values
  const result = parseResult(source.result)
  const path = String(args.path ?? args.file_path ?? result.path ?? source.fileBaseline?.path ?? '')
  const baseline =
    source.fileBaseline &&
    (source.fileBaseline.path === path || (!args.path && !args.file_path)) &&
    (!args.expected_hash || args.expected_hash === source.fileBaseline.hash)
      ? source.fileBaseline
      : undefined
  const operation = String(
    result.operation ??
      (source.toolName === 'edit_file' || args.old_text !== undefined
        ? 'edit'
        : args.append === true
          ? 'append'
          : baseline?.status === 'new'
            ? 'create'
            : 'overwrite'),
  )
  const successful =
    source.result !== undefined &&
    !source.isError &&
    !source.interrupted &&
    !result.error &&
    !result.needsSelection &&
    result.success !== false
  const structured =
    successful && Array.isArray(result.diffPreview) ? result.diffPreview : undefined
  let unknownOld = false
  let available = false
  let rows: FileDiffRow[] = []
  const fields = Array.isArray(args.steps) ? args.steps : [args]
  for (const [index, item] of (structured ? [] : fields).entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const step = item as Record<string, unknown>
    const field = operation === 'edit' ? 'new_text' : 'content'
    if (typeof step[field] !== 'string') continue
    const complete = Array.isArray(args.steps)
      ? parsed.stepCompleteFields?.[index]?.has(field)
      : parsed.completeFields.has(field)
    if (step[field] === '' && !complete) continue
    available = true
    let oldText = ''
    let oldUnavailable = false
    const selection =
      typeof step.read_ref === 'string' ? baseline?.selections?.[step.read_ref] : undefined
    if (typeof step.old_text === 'string') oldText = step.old_text
    else if (operation === 'edit' && Number.isSafeInteger(step.after_line)) oldText = ''
    else if (typeof selection === 'string') oldText = selection
    else if (baseline?.status === 'ready') {
      oldText = baseline.content ?? ''
      if (operation === 'edit') {
        const start = Number(step.line_start)
        const end = Number(step.line_end ?? start)
        if (
          Number.isSafeInteger(start) &&
          Number.isSafeInteger(end) &&
          start >= 1 &&
          end >= start
        ) {
          oldText = fileTextLines(oldText)
            .slice(start - 1, end)
            .join('\n')
        } else oldUnavailable = true
      }
    } else if (baseline?.status !== 'new') oldUnavailable = true
    unknownOld ||= oldUnavailable
    const content = step[field] as string
    const nextText = operation === 'append' ? oldText + content : content
    const nextRows = fileMutationDiff(oldUnavailable ? '' : oldText, nextText)
    // 批量步骤的行号属于各自片段，索引由轨道统一保证身份稳定。
    for (const row of nextRows) rows.push(row)
  }
  if (structured) {
    rows = structured.filter((row): row is FileDiffRow => {
      if (!row || typeof row !== 'object') return false
      const value = row as Partial<FileDiffRow>
      return (
        ['context', 'remove', 'add'].includes(String(value.kind)) && typeof value.text === 'string'
      )
    })
  }
  const reported = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.trunc(value)
      : undefined
  const insertions = successful ? reported(result.insertions) : undefined
  const deletions = successful ? reported(result.deletions) : undefined
  return {
    args,
    result,
    path,
    baseline,
    operation,
    rows,
    insertions: insertions ?? rows.filter((row) => row.kind === 'add').length,
    deletions: deletions ?? rows.filter((row) => row.kind === 'remove').length,
    available:
      available ||
      structured !== undefined ||
      insertions !== undefined ||
      deletions !== undefined ||
      rows.length > 0,
    baselineUnknown: unknownOld && deletions === undefined,
    committed: successful && result.success === true,
  }
}

export type FileMutationPreview = ReturnType<typeof fileMutationPreview>

/** 合并参数增量；关闭详情仍更新计数，隐藏页面则停止解析，终态立即追平。 */
export function useFileMutationPreview(
  read: () => FileMutationPreviewSource,
  active: () => boolean = () => true,
) {
  const capture = (): FileMutationPreviewSource => {
    const source = read()
    return {
      args: source.args,
      result: source.result,
      toolName: source.toolName,
      assembling: source.assembling,
      interrupted: source.interrupted,
      isError: source.isError,
      fileBaseline: source.fileBaseline,
    }
  }
  const snapshot = shallowRef(capture())
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    [
      () => read().args,
      () => read().result,
      () => read().assembling,
      () => read().interrupted,
      () => read().isError,
      () => read().fileBaseline,
      () => read().toolName,
      active,
    ],
    () => {
      const source = read()
      if (!active() || source.result !== undefined || source.interrupted || !source.assembling) {
        clearTimeout(timer)
        timer = undefined
        if (active()) snapshot.value = capture()
      } else if (timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined
          if (active()) snapshot.value = capture()
        }, 75)
      }
    },
  )
  onBeforeUnmount(() => clearTimeout(timer))
  return computed(() => fileMutationPreview(snapshot.value))
}

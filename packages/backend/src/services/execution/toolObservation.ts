import { t as __t } from '../../lib/i18n'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { stripBase64DataUris } from '../llm/sanitize'
import { getDataDir } from '../../lib/env'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ToolObservation')

/** 模型观察预算与脚本计算值分开，避免破坏 JSON 或改变 NIT 的计算结果。 */
export const MODEL_TOOL_OUTPUT_CHARACTERS = 128_000
const MAX_RESULT_BYTES = 64 * 1024 * 1024
const RESULT_LIFETIME_MS = 30 * 60_000
const results = new Map<string, { owner: string; text: string; bytes: number; expires: number }>()
let retainedBytes = 0
let expiryTimer: ReturnType<typeof setTimeout> | undefined

export interface ToolObservationOwner {
  agentId?: string
  threadId?: string
  taskId?: string
  channel?: string
  realmId?: string
}

export function toolObservationOwner(owner: ToolObservationOwner): string {
  return JSON.stringify([owner.agentId, owner.threadId, owner.taskId, owner.channel, owner.realmId])
}

function storedDirectory(owner: ToolObservationOwner): string {
  const hash = createHash('sha256').update(toolObservationOwner(owner)).digest('hex')
  return path.join(getDataDir(), 'runtime', 'tool-results', hash)
}

function storedResultPath(ref: string, owner: ToolObservationOwner): string | undefined {
  if (!/^tool-result:[0-9a-f-]{36}$/i.test(ref) || !owner.agentId || !owner.threadId) return
  return path.join(storedDirectory(owner), `${ref.slice('tool-result:'.length)}.txt`)
}

/** 大正文只写入内部数据目录；停机只清理内存，隐私删除才清理持久原件。 */
function storeResult(ref: string, owner: ToolObservationOwner, text: string): boolean {
  const target = storedResultPath(ref, owner)
  if (!target) return false
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(path.join(path.dirname(target), 'owner.json'), toolObservationOwner(owner), {
      mode: 0o600,
    })
    writeFileSync(`${target}.tmp`, text, { encoding: 'utf8', mode: 0o600 })
    renameSync(`${target}.tmp`, target)
    return true
  } catch (error) {
    try {
      unlinkSync(`${target}.tmp`)
    } catch {
      /* 临时文件可能尚未建立。 */
    }
    logger.warn(__t('logs.execution', '大结果持久副本保存失败，继续使用短期缓存'), { error })
    return false
  }
}

function loadStoredResult(ref: string, owner: ToolObservationOwner): string | undefined {
  const target = storedResultPath(ref, owner)
  if (!target) return
  try {
    if (
      readFileSync(path.join(path.dirname(target), 'owner.json'), 'utf8') !==
      toolObservationOwner(owner)
    )
      return
    return readFileSync(target, 'utf8')
  } catch {
    return
  }
}

function remove(ref: string): void {
  const entry = results.get(ref)
  if (entry) retainedBytes -= entry.bytes
  results.delete(ref)
}

function sweep(): void {
  for (const [ref, entry] of results) if (entry.expires <= Date.now()) remove(ref)
}

function scheduleExpiry(): void {
  if (expiryTimer || !results.size) return
  const expires = Math.min(...[...results.values()].map((entry) => entry.expires))
  expiryTimer = setTimeout(
    () => {
      expiryTimer = undefined
      sweep()
      scheduleExpiry()
    },
    Math.max(1, expires - Date.now()),
  )
  expiryTimer.unref()
}

/** 已滑出的原始材料使用现有分段读取协议，不需要额外暴露历史管理工具。 */
export function retainToolObservation(
  output: string,
  owner: ToolObservationOwner,
): string | undefined {
  if (!owner.agentId || !owner.threadId) return
  const text = stripBase64DataUris(output)
  const bytes = Buffer.byteLength(text)
  const ref = `tool-result:${randomUUID()}`
  const persistent = storeResult(ref, owner, text)
  if (bytes <= MAX_RESULT_BYTES) {
    sweep()
    while (retainedBytes + bytes > MAX_RESULT_BYTES && results.size)
      remove(results.keys().next().value!)
    results.set(ref, {
      owner: toolObservationOwner(owner),
      text,
      bytes,
      expires: Date.now() + RESULT_LIFETIME_MS,
    })
    retainedBytes += bytes
    scheduleExpiry()
    return ref
  }
  return persistent ? ref : undefined
}

/** 不猜测任意用户 JSON 的字段；仅在文件工具契约边界移出展示数据。 */
export function fileToolBusinessOutput(name: string, output: string): string {
  if (name !== 'write_file' && name !== 'edit_file') return output
  try {
    const value = JSON.parse(output)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return output
    const { diffPreview: _diff, diffTruncated: _truncated, ...business } = value
    return JSON.stringify(business)
  } catch {
    return output
  }
}

/** 超限结果返回完整外壳；执行成功与观察正文是否完整是不同事实。 */
export function modelToolObservation(
  output: string,
  owner: ToolObservationOwner,
  budget = MODEL_TOOL_OUTPUT_CHARACTERS,
): string {
  output = stripBase64DataUris(output)
  if (output.length <= budget) return output
  sweep()
  const bytes = Buffer.byteLength(output)
  let resultRef: string | undefined
  let persistent = false
  if (owner.agentId && owner.threadId) {
    resultRef = `tool-result:${randomUUID()}`
    persistent = storeResult(resultRef, owner, output)
  }
  if (resultRef && bytes <= MAX_RESULT_BYTES) {
    while (retainedBytes + bytes > MAX_RESULT_BYTES && results.size)
      remove(results.keys().next().value!)
    results.set(resultRef, {
      owner: toolObservationOwner(owner),
      text: output,
      bytes,
      expires: Date.now() + RESULT_LIFETIME_MS,
    })
    retainedBytes += bytes
    scheduleExpiry()
  }
  if (!persistent && bytes > MAX_RESULT_BYTES) resultRef = undefined
  let end = Math.max(0, Math.min(output.length, budget - 1500))
  if (end && /[\uD800-\uDBFF]/.test(output[end - 1]!)) end--
  const envelope = (length: number) =>
    JSON.stringify({
      observationTruncated: true,
      totalCharacters: output.length,
      excerpt: output.slice(0, length),
      nextOffset: length,
      ...(resultRef ? { resultRef } : {}),
      notice: resultRef
        ? `执行结果正文超过模型观察预算；片段不是完整 JSON。用 read_file_range 的 path=resultRef、offset、limit 继续读取。${persistent ? '原件保存在内部数据目录，跨消息和重启仍可读取，仅限所属会话及任务。' : '引用仅在当前进程和所属会话内短期有效。'}`
        : '执行结果正文超过模型观察预算，未保留可重读副本。不要重新执行有副作用的操作来获取正文；请按实际来源核对。',
    })
  let low = 0,
    high = end
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (envelope(middle).length <= budget) low = middle
    else high = middle - 1
  }
  if (low && /[\uD800-\uDBFF]/.test(output[low - 1]!)) low--
  return envelope(low)
}

export function readToolObservation(
  ref: string,
  owner: ToolObservationOwner,
  offset = 0,
  limit = 16_000,
) {
  sweep()
  const entry = results.get(ref)
  const text =
    entry?.owner === toolObservationOwner(owner) ? entry.text : loadStoredResult(ref, owner)
  if (text === undefined)
    throw new Error('工具结果引用已失效或不属于当前会话，请按原始来源重新读取')
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0)
    throw new Error('offset 必须是非负整数，limit 必须是正整数')
  let end = Math.min(text.length, offset + Math.min(limit, MODEL_TOOL_OUTPUT_CHARACTERS))
  if (end && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--
  return {
    resultRef: ref,
    content: text.slice(offset, end),
    totalCharacters: text.length,
    offset,
    nextOffset: end < text.length ? end : undefined,
    truncated: offset > 0 || end < text.length,
  }
}

export function releaseToolObservations(owner: ToolObservationOwner, deleteStored = false): void {
  for (const [ref, entry] of results) {
    const [agentId, threadId, taskId] = JSON.parse(entry.owner)
    if (
      (!owner.agentId || owner.agentId === agentId) &&
      (!owner.threadId || owner.threadId === threadId) &&
      (!owner.taskId || owner.taskId === taskId)
    )
      remove(ref)
  }
  if (!results.size && expiryTimer) {
    clearTimeout(expiryTimer)
    expiryTimer = undefined
  }
  if (deleteStored) {
    const root = path.join(getDataDir(), 'runtime', 'tool-results')
    let directories: string[] = []
    try {
      directories = readdirSync(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const failures: unknown[] = []
    for (const directory of directories) {
      if (!/^[a-f0-9]{64}$/.test(directory)) continue
      const target = path.join(root, directory)
      try {
        const [agentId, threadId, taskId, channel, realmId] = JSON.parse(
          readFileSync(path.join(target, 'owner.json'), 'utf8'),
        )
        if (
          (owner.agentId && owner.agentId !== agentId) ||
          (owner.threadId && owner.threadId !== threadId) ||
          (owner.taskId && owner.taskId !== taskId) ||
          (owner.channel && owner.channel !== channel) ||
          (owner.realmId && owner.realmId !== realmId)
        )
          continue
        for (const file of readdirSync(target))
          if (/^[0-9a-f-]{36}\.txt(?:\.tmp)?$/i.test(file)) unlinkSync(path.join(target, file))
        if (readdirSync(target).every((file) => file === 'owner.json')) {
          unlinkSync(path.join(target, 'owner.json'))
          rmdirSync(target)
        }
      } catch (error) {
        failures.push(error)
        logger.warn(__t('logs.execution', '清理持久工具结果失败'), { error })
      }
    }
    if (failures.length) throw new AggregateError(failures, '持久工具结果尚未清理完成')
  }
}

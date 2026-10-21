import { t as __t } from '../../lib/i18n'
import { AppError } from '../../lib/appError'
import { createLogger } from '../../lib/logger'
import { promptFingerprint } from '../llm/promptCache'

const logger = createLogger('ToolLoopGuard')
const STABLE_READS = new Set([
  'read_file',
  'read_file_range',
  'get_file_info',
  'list_directory',
  'search_files',
  'glob_files',
  'code_search',
  'run_script',
])
// 等待、终端轮询、截图、浏览器观察和社交发送等动态操作，不按相同结果计数。
const DYNAMIC =
  /(?:wait|poll|sleep|terminal_(?:read|list|status|resize)|screenshot|capture|browser|screen|social_act|send|observe)/i
interface Entry {
  action: string
  observation: string
  failed: boolean
}

function stableObservation(name: string, output: string): unknown {
  if (!STABLE_READS.has(name) || name === 'run_script') return output
  try {
    const value: unknown = JSON.parse(output)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = { ...value } as Record<string, unknown>
      // 仅去掉宿主新增的短期读取句柄；正文、路径、范围和文件 hash 仍逐项参与比较。
      delete record.read_ref
      delete record.sourceRef
      return record
    }
  } catch {
    /* 兼容旧版文本读取结果，仅规范已知的引用尾注。 */
  }
  return output.replace(/(【读取引用】read_ref=)[^；\r\n]*/g, '$1[临时读取引用]')
}

export class ToolLoopError extends AppError {
  constructor(readonly toolName: string) {
    super('LLM_ERROR', {
      message: __t(
        'server.agent',
        '工具 {0} 在提醒后仍重复相同的无进展循环，已停止本次执行；此前完成的操作保留。',
        [toolName],
      ),
      data: { retryable: false, loopDetected: true, channel: 'tools', toolName },
    })
    this.name = 'ToolLoopError'
  }
}

/** 每个 ReAct 独立持有；NIT 内部共享同一实例，绝不跨用户消息累计。 */
export class ToolLoopGuard {
  private history: Entry[] = []
  private warned = ''
  private controller = new AbortController()
  private observations = 0
  readonly signal: AbortSignal = this.controller.signal
  get observationVersion(): number {
    return this.observations
  }

  before(name: string, args: Record<string, unknown>): string | undefined {
    this.signal.throwIfAborted()
    const action = promptFingerprint([name, args])
    for (let period = 1; period <= 4; period++) {
      const cycle = this.history.slice(-period)
      if (cycle.length !== period || cycle[0]!.action !== action) continue
      const repeats = cycle.every((entry) => entry.failed) ? 6 : 12
      const recent = this.history.slice(-period * repeats)
      if (
        recent.length !== period * repeats ||
        !recent.every(
          (entry, index) =>
            entry.action === cycle[index % period]!.action &&
            entry.observation === cycle[index % period]!.observation,
        )
      )
        continue
      const signature = promptFingerprint(cycle)
      if (this.warned === signature) {
        const error = new ToolLoopError(name)
        logger.warn(__t('logs.agent', '工具循环纠偏后仍无进展，已取消所属执行中的工具'), {
          name,
          period,
          repeats,
        })
        this.controller.abort(error)
        throw error
      }
      this.warned = signature
      logger.warn(__t('logs.agent', '疑似工具无进展循环，本次拦截并给予一次纠偏机会'), {
        name,
        period,
        repeats,
      })
      return '近期相同工具参数反复得到完全相同的结果，未发现进展。本次调用未执行；请修改参数、改变方法，或依据已有结果继续。再次原样重复将停止本次执行。'
    }
    if (name !== 'run_script') this.warned = ''
  }

  observe(
    name: string,
    args: Record<string, unknown>,
    output: string,
    failed: boolean,
    beforeVersion?: number,
  ): void {
    // 有子工具时只记录子工具；纯计算脚本没有子工具，才按脚本自身结果判断重复。
    if (
      name === 'run_script' &&
      (beforeVersion === undefined || beforeVersion !== this.observations)
    )
      return
    this.observations++
    if (DYNAMIC.test(name) || (!failed && !STABLE_READS.has(name))) {
      this.history = []
      this.warned = ''
      return
    }
    this.history.push({
      action: promptFingerprint([name, args]),
      observation: promptFingerprint([failed, stableObservation(name, output)]),
      failed,
    })
    this.history = this.history.slice(-48)
  }
}

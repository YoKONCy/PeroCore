/**
 * 最小 YSM molang 运行时
 *
 * 解析并执行 YSM mod（Yes Steve Model）的控制器脚本（functions/*.molang），
 * 将脚本中 `ctrl.set_animation('xxx')` 的播放请求转发到现有动画引擎。
 *
 * YSM 脚本是 JS-like 语法，复用现有 Molang 表达式引擎的上下文
 * （query/variable/math），并补充 YSM 特有的 `ctrl` 状态机接口。
 * 文件名中的 `@player_ctrl_*` 标注执行时机：
 * - `@player_init` → 初始化脚本（模型加载后执行一次）
 * - `@player_ctrl_*` → 控制脚本（按 YSM 20tick/s 频率评估）
 *
 * 为控制复杂度，本实现采用"最小语义"：
 * - 所有控制脚本每 tick 顺序执行，取最后一个 set_animation 结果播放
 * - `ctrl.state_stop` 中断后续脚本，`state_bypass`/`state_continue` 继续
 *
 * @module packages/frontend/src/components/avatar/lib/ysm/YsmMolangRunner
 */

import { molangContext } from '../Molang'

/**
 * 规范化 Molang 变量名：去掉 v./variable. 前缀。
 *
 * Molang 编译时把 v.roaming.eyeBand 扁平化为 variable["roaming.eyeBand"]，
 * 外部写入（按钮开关）也应使用相同的扁平 key，否则两个 key 对不上导致开关无效。
 */
function normalizeVarKey(name: string): string {
  return name.replace(/^(v|variable)\./, '')
}

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 单个 YSM molang 脚本 */
export interface YsmMolangScript {
  /** 文件名（含 @player_ctrl_* 时机信息） */
  fileName: string
  /** 脚本源码 */
  source: string
}

/** 脚本执行结果状态码 */
type ScriptState = 'continue' | 'stop' | 'bypass'

/** YSM 控制器上下文（脚本通过 ctrl 接口切换动画） */
interface YsmCtrlContext {
  state_continue: string
  state_stop: string
  state_bypass: string
  /** 本轮动画播放请求（由 set_animation 写入） */
  requestedAnim: { name: string; transition: number } | null
  /** 过渡时长（由 set_beginning_transition_length 修改） */
  transition: number
  set_animation: (name: string) => void
  set_beginning_transition_length: (t: number) => void
}

/** 已编译脚本 */
interface CompiledScript {
  /** 是否为 init 脚本 */
  isInit: boolean
  /** 来源文件名。 */
  fileName: string
  /** 编译后的执行函数 */
  run: (
    variable: Record<string, number>,
    query: Record<string, number>,
    ctrl: object,
  ) => ScriptState | undefined
}

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** YSM mod 以 20 tick/s 评估脚本（与 Minecraft 游戏刻一致） */
const YSM_TICK_RATE = 20
/** 单 tick 间隔（秒） */
const YSM_TICK = 1 / YSM_TICK_RATE
/** 默认动画过渡时长（秒） */
const DEFAULT_TRANSITION = 0.2

/** 脚本文件名 → 是否初始化脚本 */
function isInitScript(fileName: string): boolean {
  return fileName.includes('@player_init') || fileName.includes('_init.molang')
}

// ═══════════════════════════════════════════════════════════════
// 编译器
// ═══════════════════════════════════════════════════════════════

/**
 * 将 YSM molang 脚本文本编译为可执行函数
 *
 * 注入命名空间：`v`（variable 变量）、`q`（query 查询）、
 * `math`（数学库）、`ctrl`（控制器接口）。
 * YSM 脚本语法是 JS 超集，直接嵌入函数体执行，失败时静默返回。
 */
function compileScript(script: YsmMolangScript): CompiledScript {
  // 剥离注释中的 CRLF 兼容问题，直接内联源码
  const body = `
    const v = variable;
    const q = query;
    const Math = _math;
    const math = _math;
    const ctrl = _ctrl;
    try {
      ${script.source}
    } catch (e) {
      // YSM 脚本异常静默，不影响主渲染
    }
  `

  // eslint-disable-next-line no-new-func -- YSM 脚本需要动态编译执行
  const compiled = new Function('variable', 'query', '_math', '_ctrl', body) as (
    variable: Record<string, number>,
    query: Record<string, number>,
    _math: object,
    _ctrl: object,
  ) => ScriptState | undefined

  return {
    isInit: isInitScript(script.fileName),
    fileName: script.fileName,
    run: (variable, query, ctrl) => compiled(variable, query, molangContext.math, ctrl),
  }
}

// ═══════════════════════════════════════════════════════════════
// 运行时
// ═══════════════════════════════════════════════════════════════

/**
 * 最小 YSM molang 运行时
 *
 * 用法：
 * 1. 模型加载时传入 functions/*.molang 脚本列表创建实例
 * 2. 调用 init() 执行初始化脚本
 * 3. 每帧调用 update(dt) 驱动控制器，返回待播放动画名
 */
export class YsmMolangRunner {
  /** 初始化脚本 */
  private initScripts: CompiledScript[] = []
  /** 控制脚本（按文件名顺序，低优先级在后） */
  private frameScripts: CompiledScript[] = []
  /** tick 累加器 */
  private tickAccum = 0

  /**
   * @param scripts - YSM molang 脚本列表
   * @param onPlayAnim - 动画播放回调（由外部接入动画引擎）
   */
  constructor(
    scripts: YsmMolangScript[],
    private readonly onPlayAnim: (name: string, transition: number) => void,
  ) {
    for (const script of scripts) {
      try {
        const compiled = compileScript(script)
        if (compiled.isInit) {
          this.initScripts.push(compiled)
        } else {
          this.frameScripts.push(compiled)
        }
      } catch {
        // 单个第三方控制器语法不兼容时跳过，不能让整个模型加载失败。
      }
    }
  }

  /** 是否包含任何脚本 */
  get hasScripts(): boolean {
    return this.initScripts.length + this.frameScripts.length > 0
  }

  /** 执行全部初始化脚本（模型加载后调用一次） */
  init(): void {
    for (const script of this.initScripts) {
      script.run(molangContext.variable, molangContext.query, {})
    }
  }

  /**
   * 每帧驱动控制器
   *
   * 按 YSM 20tick/s 频率评估控制脚本；不足一个 tick 时直接返回 null。
   * 有动画播放请求时返回该动画名（由调用方决定播放方式）。
   *
   * @param dt - 帧间隔（秒）
   * @returns 应播放的动画名；无请求时返回 null
   */
  update(dt: number): { name: string; transition: number } | null {
    this.tickAccum += dt
    if (this.tickAccum < YSM_TICK) return null
    this.tickAccum = 0

    // 本轮 tick 的播放请求（后续 set_animation 覆盖前者，直到 state_stop 中断）
    let result: { name: string; transition: number } | null = null
    let stopped = false

    for (const script of this.frameScripts) {
      if (stopped) break
      const ctrl = this.createCtrl()
      const state = script.run(molangContext.variable, molangContext.query, ctrl)
      // 脚本通过 ctrl.set_animation 写入动画请求（同步读取，规避闭包捕获）
      if (ctrl.requestedAnim) result = ctrl.requestedAnim
      if (state === 'stop') stopped = true
    }

    // 有播放请求时通过回调提交到动画引擎
    if (result) {
      this.onPlayAnim(result.name, result.transition)
    }
    return result
  }

  /** 设置外部变量（供 UI 开关等写入 YSM 变量，如 v.roaming.eyeBand / v.player_armor_head） */
  setVariable(name: string, value: number): void {
    molangContext.variable[normalizeVarKey(name)] = value
  }

  /** 读取外部变量 */
  getVariable(name: string): number {
    return molangContext.variable[normalizeVarKey(name)] ?? 0
  }

  /** 创建单次执行的 ctrl 上下文 */
  private createCtrl(): YsmCtrlContext {
    const ctrl: YsmCtrlContext = {
      state_continue: 'continue',
      state_stop: 'stop',
      state_bypass: 'bypass',
      requestedAnim: null,
      transition: DEFAULT_TRANSITION,
      set_animation: (name: string) => {
        ctrl.requestedAnim = { name, transition: ctrl.transition }
      },
      set_beginning_transition_length: (t: number) => {
        ctrl.transition = t
      },
    }
    return ctrl
  }
}

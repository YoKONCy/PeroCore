/**
 * Molang 表达式解析器
 *
 * 实现 Minecraft Bedrock 的 Molang 表达式系统的子集，
 * 用于动画控制器中的条件判断和数值计算。
 * 通过将 Molang 表达式编译为 JavaScript 函数实现高性能执行。
 *
 * @module packages/frontend/src/components/avatar/lib/Molang
 * @see https://bedrock.dev/docs/stable/MoLang
 */

import { logger } from '../../../lib/logger'

// ══════ 类型定义 ══════

/** Molang 运行时查询变量 — 对应 Bedrock 的 query.* 命名空间 */
interface MolangQueryVars {
  anim_time: number
  life_time: number
  head_x_rotation: number
  head_y_rotation: number
  is_sneaking: number
  is_moving: number
  ground_speed: number
  yaw_speed: number
  /** 默认为 1（在地面上） */
  is_on_ground: number
  vertical_speed: number
  is_riding: number
  is_sprinting: number
  is_holding_right: number
  is_holding_left: number
  [key: string]: number
}

/** 动态的 Molang 变量存储（variable.* / temp.*） */
type MolangDynamicVars = Record<string, number>

/** Molang 数学函数库（角度制） */
interface MolangMathLib {
  sin: (deg: number) => number
  cos: (deg: number) => number
  tan: (deg: number) => number
  asin: (x: number) => number
  acos: (x: number) => number
  atan: (x: number) => number
  atan2: (y: number, x: number) => number
  clamp: (val: number, min: number, max: number) => number
  lerp: (a: number, b: number, t: number) => number
  lerprotate: (a: number, b: number, t: number) => number
  abs: (x: number) => number
  min: (...values: number[]) => number
  max: (...values: number[]) => number
  pow: (base: number, exp: number) => number
  sqrt: (x: number) => number
  round: (x: number) => number
  ceil: (x: number) => number
  floor: (x: number) => number
  mod: (a: number, b: number) => number
  random: (min: number, max: number) => number
  die_roll: (num: number, low: number, high: number) => number
  die_roll_integer: (num: number, low: number, high: number) => number
}

/** Molang 上下文 — 表达式执行时可访问的所有命名空间 */
export interface MolangContext {
  query: MolangQueryVars
  variable: MolangDynamicVars
  temp: MolangDynamicVars
  control: MolangDynamicVars
  math: MolangMathLib
}

/** 编译后的 Molang 函数签名 */
type MolangFunc = (context: MolangContext) => number

// ══════ 工具函数 ══════

/** 创建带默认返回 0 的 Proxy（模拟 Molang 未定义变量行为） */
function createDynamicProxy(initial: Record<string, number> = {}): MolangDynamicVars {
  return new Proxy(initial, {
    get: (target: Record<string, number>, prop: string) => {
      return prop in target ? target[prop] : 0
    },
    set: (target: Record<string, number>, prop: string, value: number) => {
      target[prop] = value
      return true
    },
  })
}

// ══════ 全局上下文 ══════

/**
 * 全局 Molang 运行时上下文
 *
 * 所有动画控制器和表达式共享此上下文，
 * 通过 Proxy 实现未定义变量自动返回 0 的行为。
 */
export const molangContext: MolangContext = {
  query: createDynamicProxy({
    anim_time: 0,
    life_time: 0,
    head_x_rotation: 0,
    head_y_rotation: 0,
    is_sneaking: 0,
    is_moving: 0,
    ground_speed: 0,
    yaw_speed: 0,
    is_on_ground: 1,
    vertical_speed: 0,
    is_riding: 0,
    is_sprinting: 0,
    is_holding_right: 0,
    is_holding_left: 0,
  }) as MolangQueryVars,

  variable: createDynamicProxy(),
  temp: createDynamicProxy(),
  control: createDynamicProxy(),

  math: {
    // 三角函数（角度制 → 弧度制）
    sin: (deg: number) => Math.sin((deg * Math.PI) / 180),
    cos: (deg: number) => Math.cos((deg * Math.PI) / 180),
    tan: (deg: number) => Math.tan((deg * Math.PI) / 180),
    asin: (x: number) => (Math.asin(x) * 180) / Math.PI,
    acos: (x: number) => (Math.acos(x) * 180) / Math.PI,
    atan: (x: number) => (Math.atan(x) * 180) / Math.PI,
    atan2: (y: number, x: number) => (Math.atan2(y, x) * 180) / Math.PI,

    // 工具函数
    clamp: (val: number, min: number, max: number) => Math.min(Math.max(val, min), max),
    lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    lerprotate: (a: number, b: number, t: number) => {
      // 角度的最短路径插值
      let diff = b - a
      while (diff > 180) diff -= 360
      while (diff < -180) diff += 360
      return a + diff * t
    },

    // 标准数学
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    sqrt: Math.sqrt,
    round: Math.round,
    ceil: Math.ceil,
    floor: Math.floor,
    mod: (a: number, b: number) => a % b,

    // 随机
    random: (min: number, max: number) => Math.random() * (max - min) + min,
    die_roll: (num: number, low: number, high: number) => {
      let sum = 0
      for (let i = 0; i < num; i++) {
        sum += Math.floor(Math.random() * (high - low + 1)) + low
      }
      return sum
    },
    die_roll_integer: (num: number, low: number, high: number) => {
      let sum = 0
      for (let i = 0; i < num; i++) {
        sum += Math.floor(Math.random() * (high - low + 1)) + low
      }
      return sum
    },
  },
}

// ══════ Molang 编译器 ══════

/**
 * Molang 表达式编译器
 *
 * 将 Molang 文本表达式编译为 JavaScript 函数并缓存，
 * 后续调用直接执行缓存的函数以避免重复编译开销。
 */
export class Molang {
  /** 已编译表达式缓存 (Key = 原始表达式字符串) */
  private cache: Map<string, MolangFunc>

  constructor() {
    this.cache = new Map()
  }

  /**
   * 将 Molang 表达式编译为可执行函数
   *
   * @param expression - Molang 表达式（字符串或数字）
   * @returns 编译后的函数，接受 MolangContext 参数返回数字
   */
  parse(expression: string | number): MolangFunc | undefined {
    if (typeof expression === 'number') return () => expression

    const key = String(expression)
    if (this.cache.has(key)) return this.cache.get(key)

    let jsExpr = key

    // 移除 return 关键字（Molang 使用隐式返回）
    jsExpr = jsExpr.replace(/\breturn\s+/g, '')

    // 多语句用逗号运算符连接（最后一个表达式作为返回值）
    if (jsExpr.includes(';')) {
      jsExpr = jsExpr
        .split(';')
        .filter((p: string) => p.trim() !== '')
        .join(',')
    }

    try {
      // 构建带上下文别名的函数体
      const funcBody = `
        const query = context.query;
        const q = context.query;
        const variable = context.variable;
        const v = context.variable;
        const V = context.variable;
        const temp = context.temp;
        const t = context.temp;
        const T = context.temp;
        const ctrl = context.control;
        const c = context.control;
        const math = context.math;
        const Math = context.math;
        const Q = context.query;

        try {
          return ${jsExpr};
        } catch(e) {
          return 0;
        }
      `

      // eslint-disable-next-line no-new-func -- Molang 运行时需要动态编译
      const func = new Function('context', funcBody) as MolangFunc
      this.cache.set(key, func)
      return func
    } catch (e) {
      // 编译失败时只警告一次，然后缓存返回 0 的函数
      logger.warn('Molang', `编译失败，已静默: ${expression}`, e)
      const fallback: MolangFunc = () => 0
      this.cache.set(key, fallback)
      return fallback
    }
  }

  /**
   * 直接求值 Molang 表达式
   *
   * @param expression - Molang 表达式
   * @returns 计算结果（失败时返回 0）
   */
  eval(expression: string | number): number {
    if (typeof expression === 'number') return expression
    if (!expression) return 0
    const func = this.parse(expression)
    return func ? func(molangContext) : 0
  }
}

/** 全局 Molang 解析器实例 */
export const molang = new Molang()

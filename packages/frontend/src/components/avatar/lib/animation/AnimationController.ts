/**
 * Bedrock 动画控制器
 *
 * 实现 Minecraft Bedrock 动画控制器的状态机逻辑。
 * 支持状态转换（Molang 条件）、混合权重表达式、
 * 进入/退出回调以及动画的平滑过渡。
 *
 * @module packages/frontend/src/components/avatar/lib/animation/AnimationController
 */

import type { AnimationEngine } from './AnimationEngine'
import type { AnimationLibrary } from './AnimationLibrary'
import { molang } from '../Molang'

// ══════ Bedrock JSON 结构定义 ══════

/** Bedrock 动画控制器 JSON 文件根结构 */
interface IBedrockControllerJson {
  format_version: string
  animation_controllers: Record<string, IBedrockControllerDef>
}

/** 单个控制器定义 */
interface IBedrockControllerDef {
  /** 初始状态名称（默认使用第一个） */
  initial_state?: string
  /** 状态映射 */
  states: Record<string, IBedrockStateDef>
}

/** 状态定义 */
interface IBedrockStateDef {
  /** 要播放的动画列表（字符串或带混合表达式的对象） */
  animations?: (string | Record<string, string>)[]
  /** 状态转换条件列表 */
  transitions?: Record<string, string>[]
  /** 进入状态时执行的 Molang 表达式 */
  on_entry?: string[]
  /** 退出状态时执行的 Molang 表达式 */
  on_exit?: string[]
  /** 混合过渡时间（秒） */
  blend_transition?: number
}

// ══════ 运行时状态 ══════

/** 控制器状态的运行时包装 */
class ControllerState {
  name: string
  def: IBedrockStateDef

  constructor(name: string, def: IBedrockStateDef) {
    this.name = name
    this.def = def
  }
}

// ══════ 控制器实例 ══════

/**
 * Bedrock 动画控制器实例
 *
 * 对应 `animation_controllers` 中的一个控制器条目，
 * 维护状态机运行时的当前状态、转换逻辑和动画播放。
 */
export class BedrockAnimationController {
  /** 控制器名称 */
  name: string
  private states: Map<string, ControllerState> = new Map()
  private currentState: ControllerState | null = null
  private engine: AnimationEngine
  private library: AnimationLibrary
  private stateTime: number = 0
  /** 当前状态播放的动画列表，用于退出时停止 */
  private activeAnimations: Set<string> = new Set()

  constructor(
    name: string,
    def: IBedrockControllerDef,
    engine: AnimationEngine,
    library: AnimationLibrary,
  ) {
    this.name = name
    this.engine = engine
    this.library = library

    // 解析状态
    for (const [stateName, stateDef] of Object.entries(def.states)) {
      this.states.set(stateName, new ControllerState(stateName, stateDef))
    }

    // 设置初始状态
    if (def.initial_state && this.states.has(def.initial_state)) {
      this.enterState(def.initial_state)
    } else if (this.states.size > 0) {
      // 默认进入第一个定义的状态
      const firstState = this.states.keys().next().value
      if (firstState) this.enterState(firstState as string)
    }
  }

  /**
   * 每帧更新：检查转换条件、更新动画混合权重
   *
   * @param dt - 帧间隔（秒）
   */
  update(dt: number): void {
    if (!this.currentState) return
    this.stateTime += dt

    // 检查状态转换
    if (this.currentState.def.transitions) {
      for (const trans of this.currentState.def.transitions) {
        for (const [targetStateName, conditionExpr] of Object.entries(trans)) {
          if (molang.eval(conditionExpr)) {
            this.enterState(targetStateName)
            return // 状态改变，本帧结束
          }
        }
      }
    }

    // 更新当前状态下带有混合表达式的动画权重
    if (this.currentState.def.animations) {
      for (const animEntry of this.currentState.def.animations) {
        if (typeof animEntry !== 'string') {
          // 对象形式: { "动画名称": "混合表达式" }
          for (const [animName, blendExpr] of Object.entries(animEntry)) {
            const weight = molang.eval(blendExpr)
            const anim = this.library.get(animName)
            if (anim) {
              // 实时更新混合权重，不影响淡入淡出
              this.engine.setBlendWeight(animName, Math.max(0, weight))

              // 权重从 0 变为 > 0 时启动动画
              if (weight > 0 && !this.activeAnimations.has(animName)) {
                this.engine.play(anim, 0, true, 1.0)
                this.activeAnimations.add(animName)
              }
            }
          }
        }
      }
    }
  }

  /** 获取当前状态名称 */
  getCurrentStateName(): string {
    return this.currentState ? this.currentState.name : ''
  }

  // ══════ 内部方法 ══════

  /** 进入新状态：执行退出/进入回调、停止旧动画、启动新动画 */
  private enterState(stateName: string): void {
    const nextState = this.states.get(stateName)
    if (!nextState) {
      console.warn(`[动画控制器] 未找到状态: ${stateName}`)
      return
    }

    // 执行当前状态的退出指令 (on_exit)
    if (this.currentState?.def.on_exit) {
      this.currentState.def.on_exit.forEach((expr) => molang.eval(expr))
    }

    // 计算淡出时间（基岩版默认 0.25s，可通过 blend_transition 覆盖）
    let fadeTime = 0.2
    if (this.currentState?.def.blend_transition !== undefined) {
      fadeTime = this.currentState.def.blend_transition
    }

    // 收集新状态将要播放的动画
    const nextAnimNames = new Set<string>()
    if (nextState.def.animations) {
      nextState.def.animations.forEach((entry) => {
        if (typeof entry === 'string') nextAnimNames.add(entry)
        else Object.keys(entry).forEach((k) => nextAnimNames.add(k))
      })
    }

    // 停止旧状态中不再需要的动画（新状态也播放的动画保留，实现平滑过渡）
    for (const animName of this.activeAnimations) {
      if (!nextAnimNames.has(animName)) {
        this.engine.stop(animName, fadeTime)
      }
    }
    this.activeAnimations.clear()

    // 切换状态
    const prevStateName = this.currentState ? this.currentState.name : 'null'
    this.currentState = nextState
    this.stateTime = 0

    console.log(`[控制器: ${this.name}] 转换: ${prevStateName} -> ${stateName}`)

    // 执行新状态的进入指令 (on_entry)
    if (this.currentState.def.on_entry) {
      this.currentState.def.on_entry.forEach((expr) => molang.eval(expr))
    }

    // 播放新状态的动画
    if (this.currentState.def.animations) {
      for (const animEntry of this.currentState.def.animations) {
        if (typeof animEntry === 'string') {
          const anim = this.library.get(animEntry)
          if (anim) {
            this.engine.play(anim, fadeTime, true, 1.0)
            this.activeAnimations.add(animEntry)
          }
        } else {
          // 带混合表达式的动画
          for (const [animName, expr] of Object.entries(animEntry)) {
            const weight = molang.eval(expr)
            const anim = this.library.get(animName)
            if (anim) {
              this.engine.play(anim, fadeTime, true, 1.0)
              this.engine.setBlendWeight(animName, Math.max(0, weight))
              this.activeAnimations.add(animName)
            }
          }
        }
      }
    }
  }
}

// ══════ 控制器系统 ══════

/**
 * 动画控制器系统
 *
 * 管理多个 BedrockAnimationController 实例，
 * 提供从 JSON 文件或对象批量加载控制器的能力。
 */
export class AnimationControllerSystem {
  /** 活动的控制器列表 */
  controllers: BedrockAnimationController[] = []
  private engine: AnimationEngine
  private library: AnimationLibrary

  constructor(engine: AnimationEngine, library: AnimationLibrary) {
    this.engine = engine
    this.library = library
  }

  /**
   * 从 URL 加载控制器 JSON 文件
   *
   * @param url - 控制器 JSON 文件 URL
   */
  async load(url: string): Promise<void> {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`无法加载控制器: ${url}`)

      const json = (await response.json()) as IBedrockControllerJson
      this.loadFromJson(json)
    } catch (e) {
      console.error(`[AnimationControllerSystem] 从 ${url} 加载控制器出错:`, e)
    }
  }

  /**
   * 直接从 JSON 对象加载控制器
   *
   * @param json - Bedrock 控制器 JSON 对象
   */
  loadFromJson(json: IBedrockControllerJson): void {
    if (json.animation_controllers) {
      for (const [name, def] of Object.entries(json.animation_controllers)) {
        const ctrl = new BedrockAnimationController(name, def, this.engine, this.library)
        this.controllers.push(ctrl)
      }
    }
  }

  /**
   * 每帧更新所有控制器
   *
   * @param dt - 帧间隔（秒）
   */
  update(dt: number): void {
    for (const ctrl of this.controllers) {
      ctrl.update(dt)
    }
  }

  /** 重置系统 — 停止所有动画并清空控制器 */
  reset(): void {
    this.engine.stop()
    this.controllers = []
  }
}

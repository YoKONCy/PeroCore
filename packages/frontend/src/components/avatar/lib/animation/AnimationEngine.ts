/**
 * 动画引擎
 *
 * 管理活动动画状态的播放、权重混合和骨骼变换应用。
 * 支持多动画同时播放并按权重混合，使用 Molang 表达式实时计算轨道值。
 *
 * @module packages/frontend/src/components/avatar/lib/animation/AnimationEngine
 */

import * as THREE from 'three'
import type { IAnimationData, IKeyframe } from './AnimationTypes'
import type { RetargetingManager } from '../retargeting/RetargetingManager'
import { molang, molangContext } from '../Molang'

// ══════ 内部类型 ══════

/** 关键帧值 — 向量、Molang 字符串或标量 */
type KeyframeValue = [number, number, number] | string | number

/** 三维向量元组 */
type Vec3Tuple = [number, number, number]

// ══════ 动画状态 ══════

/** 单个动画的运行时状态（内部使用） */
class AnimationState {
  /** 关联的动画数据 */
  data: IAnimationData
  /** 当前播放时间（秒） */
  time: number = 0
  /** 当前权重（0-1，用于淡入淡出） */
  weight: number = 0
  /** 目标权重 */
  targetWeight: number = 0
  /** 淡入淡出速度（权重/秒） */
  fadeSpeed: number = 0
  /** 混合权重（控制器级） */
  blendWeight: number = 1.0
  /** 是否循环 */
  loop: boolean = true
  /** 播放速度倍率 */
  speed: number = 1.0

  constructor(data: IAnimationData) {
    this.data = data
    this.loop = data.loop
  }

  /** 每帧更新权重和时间 */
  update(dt: number): void {
    // 权重淡入淡出
    if (this.weight !== this.targetWeight) {
      const delta = this.fadeSpeed * dt
      if (this.weight < this.targetWeight) {
        this.weight = Math.min(this.targetWeight, this.weight + delta)
      } else {
        this.weight = Math.max(this.targetWeight, this.weight - delta)
      }
    }

    // 时间推进
    this.time += dt * this.speed
    if (this.loop && this.data.length > 0) {
      this.time = this.time % this.data.length
    } else if (!this.loop && this.time > this.data.length) {
      this.time = this.data.length
    }
  }
}

// ══════ 动画引擎 ══════

/**
 * 动画引擎
 *
 * 核心动画播放系统，负责：
 * - 管理多个同时活动的动画状态
 * - 按权重进行旋转/位移/缩放的混合
 * - 将混合结果通过 RetargetingManager 应用到骨骼
 */
export class AnimationEngine {
  private activeStates: AnimationState[] = []
  private retargetingManager: RetargetingManager
  /** 是否锁定根骨骼位移（防止角色在场景中滑动） */
  public lockRootPosition: boolean = false

  constructor(retargetingManager: RetargetingManager) {
    this.retargetingManager = retargetingManager
  }

  /**
   * 播放动画
   *
   * @param anim - 动画数据
   * @param fadeTime - 淡入时间（秒，0 表示立即切换）
   * @param loop - 是否循环
   * @param weight - 混合权重（0-1）
   */
  play(
    anim: IAnimationData,
    fadeTime: number = 0.2,
    loop: boolean = true,
    weight: number = 1.0,
  ): void {
    let state = this.activeStates.find((s) => s.data.name === anim.name)

    if (!state) {
      state = new AnimationState(anim)
      this.activeStates.push(state)
    }

    state.loop = loop
    state.targetWeight = weight

    if (fadeTime > 0) {
      state.fadeSpeed = 1.0 / fadeTime
    } else {
      state.weight = weight
      state.fadeSpeed = 0
    }
  }

  /**
   * 设置动画的混合权重（控制器级）
   *
   * @param animName - 动画名称
   * @param weight - 混合权重
   */
  setBlendWeight(animName: string, weight: number): void {
    const state = this.activeStates.find((s) => s.data.name === animName)
    if (state) {
      state.blendWeight = weight
    }
  }

  /**
   * 停止动画
   *
   * @param animName - 动画名称（省略则停止所有）
   * @param fadeTime - 淡出时间（秒，0 表示立即停止）
   */
  stop(animName?: string, fadeTime: number = 0.2): void {
    const targets = animName
      ? this.activeStates.filter((s) => s.data.name === animName)
      : this.activeStates

    for (const state of targets) {
      state.targetWeight = 0.0
      if (fadeTime > 0) {
        state.fadeSpeed = 1.0 / fadeTime
      } else {
        state.weight = 0.0
      }
    }
  }

  /**
   * 每帧更新
   *
   * 重置骨骼到初始姿态，然后应用所有活动动画的混合结果。
   *
   * @param dt - 帧间隔（秒）
   */
  update(dt: number): void {
    // 无论是否有动画，每帧都必须重置骨骼到初始姿态，
    // 否则程序化动画（如头部追踪）会累加旋转导致"旋转爆炸"
    this.retargetingManager.reset()

    if (this.activeStates.length === 0) return

    // 更新状态并移除已完成淡出的动画
    for (let i = this.activeStates.length - 1; i >= 0; i--) {
      const state = this.activeStates[i]!
      state.update(dt)

      // 权重趋近于 0 且目标也是 0 → 移除
      if (state.weight <= 0.0001 && state.targetWeight <= 0.0001) {
        this.activeStates.splice(i, 1)
      }
    }

    if (this.activeStates.length === 0) return

    molangContext.query.life_time += dt

    // 收集所有受影响的骨骼名称
    const affectedBones = new Set<string>()
    for (const state of this.activeStates) {
      Object.keys(state.data.bones).forEach((b) => affectedBones.add(b))
    }

    this.applyBlendedAnimation(affectedBones)
  }

  // ══════ 内部方法 ══════

  /** 将所有活动动画按权重混合并应用到骨骼 */
  private applyBlendedAnimation(bones: Set<string>): void {
    for (const boneName of bones) {
      const finalPos = new THREE.Vector3()
      const finalScale = new THREE.Vector3()
      // 旋转增量累加器（欧拉角，弧度）
      const rotDelta = new THREE.Vector3(0, 0, 0)

      // 各通道独立统计权重：YSM 的并行动画往往只改 scale（部件开关/物理），
      // 若与 idle 共用一个 totalWeight 平均，scale 会被稀释（如 0/1 → 0.5/0）。
      let wPos = 0
      let wScale = 0
      let hasPos = false
      let hasScale = false
      let hasRot = false

      // 获取初始旋转（直接使用缓存的欧拉角，避免四元数转换的角度歧义）
      const initialEuler = this.retargetingManager.getInitialEuler(boneName)

      const boneObj = this.retargetingManager.getBone(boneName)
      const restPos = boneObj ? boneObj.position.clone() : new THREE.Vector3()
      const restScale = boneObj ? boneObj.scale.clone() : new THREE.Vector3(1, 1, 1)

      for (const state of this.activeStates) {
        const effectiveWeight = state.weight * state.blendWeight
        if (effectiveWeight <= 0.0001) continue

        const tracks = state.data.bones[boneName]
        if (!tracks) continue

        molangContext.query.anim_time = state.time

        // 旋转（动画旋转是相对于初始姿势的增量）
        if (tracks.rotation) {
          const val = this.evaluateTrack(tracks.rotation, state.time)
          if (val) {
            // base岩版 → Three.js 坐标系转换：X/Y 轴取反，Z 轴不变
            rotDelta.x += THREE.MathUtils.degToRad(-val[0]) * effectiveWeight
            rotDelta.y += THREE.MathUtils.degToRad(-val[1]) * effectiveWeight
            rotDelta.z += THREE.MathUtils.degToRad(val[2]) * effectiveWeight
            hasRot = true
          }
        }

        // 位移（权重独立累加）
        if (tracks.position) {
          const val = this.evaluateTrack(tracks.position, state.time)
          if (val) {
            finalPos.addScaledVector(restPos, effectiveWeight)
            finalPos.addScaledVector(new THREE.Vector3(-val[0], val[1], val[2]), effectiveWeight)
            wPos += effectiveWeight
            hasPos = true
          }
        }

        // 缩放（权重独立累加）
        if (tracks.scale) {
          const val = this.evaluateTrack(tracks.scale, state.time)
          if (val) {
            finalScale.addScaledVector(new THREE.Vector3(val[0], val[1], val[2]), effectiveWeight)
            wScale += effectiveWeight
            hasScale = true
          }
        }
      }

      // 各通道独立与休息姿势混合（动画权重不足 1 的部分补 rest）
      if (hasPos && wPos < 0.999) {
        finalPos.addScaledVector(restPos, 1.0 - wPos)
      }
      if (hasScale && wScale < 0.999) {
        finalScale.addScaledVector(restScale, 1.0 - wScale)
      }

      // 应用旋转：最终旋转 = 初始旋转 + 动画增量
      if (hasRot) {
        const resultEuler = new THREE.Euler(
          initialEuler.x + rotDelta.x,
          initialEuler.y + rotDelta.y,
          initialEuler.z + rotDelta.z,
          initialEuler.order,
        )
        this.retargetingManager.applyRotation(boneName, resultEuler)
      }

      // 应用位移（按 position 权重归一化）
      if (hasPos && wPos > 0.001) {
        if (Math.abs(wPos - 1.0) > 0.01) {
          finalPos.divideScalar(wPos)
        }
        if (this.lockRootPosition && boneName === 'Root') {
          finalPos.x = 0
          finalPos.z = 0
        }
        this.retargetingManager.applyPosition(boneName, finalPos)
      }

      // 应用缩放（按 scale 权重归一化）
      if (hasScale && wScale > 0.001) {
        if (Math.abs(wScale - 1.0) > 0.01) {
          finalScale.divideScalar(wScale)
        }
        this.retargetingManager.applyScale(boneName, finalScale)
      }
    }
  }

  /** 对关键帧序列在指定时间点求值（线性 / CatmullRom 插值） */
  private evaluateTrack(keyframes: IKeyframe[], time: number): Vec3Tuple | null {
    if (keyframes.length === 0) return null

    if (time <= keyframes[0]!.time) return this.resolveValue(keyframes[0]!.value)
    if (time >= keyframes[keyframes.length - 1]!.time) {
      return this.resolveValue(keyframes[keyframes.length - 1]!.value)
    }

    const nextIdx = keyframes.findIndex((k) => k.time > time)
    const prev = keyframes[nextIdx - 1]!
    const next = keyframes[nextIdx]!

    const range = next.time - prev.time
    const t = range > 0 ? (time - prev.time) / range : 0

    const v1 = this.resolveValue(prev.value)
    const v2 = this.resolveValue(next.value)

    // CatmullRom 插值
    if (prev.lerpMode === 'catmullrom') {
      const prevPrev = keyframes[nextIdx - 2] ?? prev
      const nextNext = keyframes[nextIdx + 1] ?? next
      const v0 = this.resolveValue(prevPrev.value)
      const v3 = this.resolveValue(nextNext.value)

      return [
        this.catmullRom(v0[0], v1[0], v2[0], v3[0], t),
        this.catmullRom(v0[1], v1[1], v2[1], v3[1], t),
        this.catmullRom(v0[2], v1[2], v2[2], v3[2], t),
      ]
    }

    // 线性插值
    return [v1[0] + (v2[0] - v1[0]) * t, v1[1] + (v2[1] - v1[1]) * t, v1[2] + (v2[2] - v1[2]) * t]
  }

  /** CatmullRom 一维样条插值 */
  private catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const v0 = (p2 - p0) * 0.5
    const v1 = (p3 - p1) * 0.5
    const t2 = t * t
    const t3 = t * t2
    return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1
  }

  /**
   * 解析关键帧值
   *
   * 支持三种格式：
   * - 数组 [x, y, z]（可含 Molang 字符串元素）
   * - Molang 字符串 → 展开为 [v, v, v]
   * - 标量数字 → 展开为 [v, v, v]
   */
  private resolveValue(val: KeyframeValue): Vec3Tuple {
    if (Array.isArray(val)) {
      return [
        typeof val[0] === 'string' ? molang.eval(val[0]) : val[0],
        typeof val[1] === 'string' ? molang.eval(val[1]) : val[1],
        typeof val[2] === 'string' ? molang.eval(val[2]) : val[2],
      ]
    } else if (typeof val === 'string') {
      const v = molang.eval(val)
      return [v, v, v]
    }
    return [val, val, val]
  }
}

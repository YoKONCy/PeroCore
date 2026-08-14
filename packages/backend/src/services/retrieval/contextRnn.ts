/**
 * ContextRNN — 对话轨迹感知 (minGRU)
 *
 * 维护一个持久隐状态 h_t，编码"对话一直在往哪个方向走"。
 * 在聊料理时想到"主人"和在聊工作时想到"主人"，应联想到完全不同的记忆。
 *
 * 投影矩阵使用 Xavier 随机初始化。
 * 隐状态持久化到 data/agent_{id}/rnn_{mode}.bin (1KB)。
 *
 * 依赖 @infos/nit-runtime 的 minGRU 前向推理 (TS mock 或 Rust N-API)。
 *
 * @module packages/backend/src/services/retrieval/contextRnn
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  HIDDEN_DIM,
  projectInput,
  minGruForwardWithWeights,
  xavierInitMinGruWeights,
  trainMinGruStep,
  MIN_GRU_WEIGHT_SIZES,
} from '@infos/nit-runtime'
import type { MinGruWeights } from '@infos/nit-runtime'
import type { PathResolver } from '../../core/pathResolver'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ContextRNN')

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

/** Embedding 维度 (与 EmbeddingProvider 对齐) */
const INPUT_DIM = 1536

/** 投影矩阵总元素数 (W_in: INPUT_DIM × HIDDEN_DIM) */
const PROJ_MATRIX_SIZE = INPUT_DIM * HIDDEN_DIM

/** 输出矩阵总元素数 (W_out: HIDDEN_DIM × INPUT_DIM) — h_t 映射回 embedding 空间 */
const OUTPUT_MATRIX_SIZE = HIDDEN_DIM * INPUT_DIM

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** ContextRNN 持久化数据 */
interface RnnState {
  /** 隐状态 (256 维) */
  hidden: Float32Array
  /** 最后更新时间戳 */
  lastUpdatedAt: number
  /** 累计更新次数 (用于统计) */
  updateCount: number
}

/** ContextRNN 配置 */
export interface ContextRnnConfig {
  /** Embedding 输入维度 */
  inputDim: number
  /** 隐状态维度 */
  hiddenDim: number
}

const DEFAULT_CONFIG: ContextRnnConfig = {
  inputDim: INPUT_DIM,
  hiddenDim: HIDDEN_DIM,
}

// ─────────────────────────────────────────────
// Xavier 初始化
// ─────────────────────────────────────────────

/**
 * Xavier 均匀分布初始化
 *
 * 范围: [-limit, +limit] 其中 limit = sqrt(6 / (fanIn + fanOut))
 */
function xavierUniform(fanIn: number, fanOut: number, size: number): Float32Array {
  const limit = Math.sqrt(6.0 / (fanIn + fanOut))
  const arr = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    arr[i] = (Math.random() * 2 - 1) * limit
  }
  return arr
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class ContextRnn {
  private config: ContextRnnConfig
  private pathResolver: PathResolver

  /** 每个 Agent+Mode 的隐状态缓存 */
  private states = new Map<string, RnnState>()

  /** 投影矩阵 W_in (INPUT_DIM × HIDDEN_DIM) — 全局共享 */
  private projMatrix: Float32Array

  /** 输出矩阵 W_out (HIDDEN_DIM × INPUT_DIM) — h_t → 偏置向量 */
  private outputMatrix: Float32Array

  /**
   * minGRU 内部权重（AIOS 第八阶段：从 Rust 全局单例移到 TS 侧管理）
   *
   * W_z/b_z: 门控权重和偏置
   * W_h/b_h: 候选状态权重和偏置
   *
   * 这些权重会被持久化到 rnn_mingru.bin，并在训练时在线更新。
   */
  private minGruWeights: MinGruWeights

  constructor(pathResolver: PathResolver, config?: Partial<ContextRnnConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.pathResolver = pathResolver

    // 尝试加载已持久化的权重，否则 Xavier 初始化
    this.projMatrix = this.loadOrInitWeights('proj', PROJ_MATRIX_SIZE, INPUT_DIM, HIDDEN_DIM)
    this.outputMatrix = this.loadOrInitWeights('output', OUTPUT_MATRIX_SIZE, HIDDEN_DIM, INPUT_DIM)

    // AIOS 第八阶段：加载或初始化 minGRU 内部权重
    this.minGruWeights = this.loadOrInitMinGruWeights()

    logger.info(
      `ContextRNN 初始化完成 (inputDim=${this.config.inputDim}, hiddenDim=${this.config.hiddenDim})`,
    )
  }

  /**
   * 更新隐状态 h_t → h_{t+1}
   *
   * 每轮对话输入 query embedding，更新对话轨迹感知状态。
   *
   * AIOS 第八阶段：改用 minGruForwardWithWeights，使用 TS 侧管理的权重，
   * 不再依赖 Rust 全局单例（确保权重持久化和训练生效）。
   */
  update(agentId: string, mode: string, queryEmbedding: number[]): void {
    const state = this.getOrCreateState(agentId, mode)

    // 1. 投影: 1536 → 256
    const input = new Float32Array(queryEmbedding)
    const projected = projectInput(input, this.projMatrix)

    // 2. minGRU 前向: h_t + x_t → h_{t+1}（使用 TS 侧管理的权重）
    const newHidden = minGruForwardWithWeights(state.hidden, projected, this.minGruWeights)

    // 3. 更新状态
    state.hidden = newHidden
    state.lastUpdatedAt = Date.now()
    state.updateCount++
  }

  /**
   * 获取当前隐状态
   */
  getHiddenState(agentId: string, mode: string): Float32Array {
    return this.getOrCreateState(agentId, mode).hidden
  }

  /**
   * 生成上下文偏置向量 (h_t → 1536 维)
   *
   * 用于 context-aware 重排: 与候选记忆的 embedding 做点积，
   * 得到 contextAffinity 分数。
   */
  generateBias(agentId: string, mode: string): Float32Array {
    const h = this.getHiddenState(agentId, mode)

    // W_out @ h_t → 1536 维偏置向量
    const bias = new Float32Array(INPUT_DIM)
    for (let i = 0; i < INPUT_DIM; i++) {
      let sum = 0
      for (let j = 0; j < HIDDEN_DIM; j++) {
        sum += this.outputMatrix[j * INPUT_DIM + i]! * h[j]!
      }
      bias[i] = sum
    }

    return bias
  }

  /**
   * 计算隐状态与 centroid 的亲和度 (用于 Cluster 路由)
   *
   * affinities = softmax(h_t · centroids^T)
   */
  computeClusterAffinities(
    agentId: string,
    mode: string,
    centroids: Map<number, Float32Array>,
  ): Map<number, number> {
    const h = this.getHiddenState(agentId, mode)
    const affinities = new Map<number, number>()

    if (centroids.size === 0) return affinities

    // 计算 h_t · centroid_i 的点积
    const dots: Array<{ clusterId: number; dot: number }> = []
    for (const [clusterId, centroid] of centroids) {
      let dot = 0
      const len = Math.min(h.length, centroid.length)
      for (let i = 0; i < len; i++) {
        dot += h[i]! * centroid[i]!
      }
      dots.push({ clusterId, dot })
    }

    // Softmax
    const maxDot = Math.max(...dots.map((d) => d.dot))
    let expSum = 0
    const exps = dots.map((d) => {
      const e = Math.exp(d.dot - maxDot) // 数值稳定
      expSum += e
      return { clusterId: d.clusterId, exp: e }
    })

    for (const { clusterId, exp } of exps) {
      affinities.set(clusterId, exp / expSum)
    }

    return affinities
  }

  /**
   * 持久化指定 Agent 的隐状态到磁盘
   */
  save(agentId: string, mode: string): void {
    const key = `${agentId}:${mode}`
    const state = this.states.get(key)
    if (!state) return

    const filePath = this.resolveStatePath(agentId, mode)
    const dir = path.dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    // 写入: [updateCount (4B)] + [lastUpdatedAt (8B)] + [hidden (256×4B = 1024B)]
    const buffer = Buffer.alloc(4 + 8 + state.hidden.byteLength)
    buffer.writeUInt32LE(state.updateCount, 0)
    buffer.writeDoubleBE(state.lastUpdatedAt, 4)
    Buffer.from(state.hidden.buffer).copy(buffer, 12)

    writeFileSync(filePath, buffer)
    logger.debug(`RNN 隐状态已保存: ${filePath} (updates=${state.updateCount})`)
  }

  /**
   * 从磁盘恢复隐状态
   */
  load(agentId: string, mode: string): boolean {
    const filePath = this.resolveStatePath(agentId, mode)
    if (!existsSync(filePath)) return false

    try {
      const buffer = readFileSync(filePath)
      if (buffer.length < 12 + HIDDEN_DIM * 4) return false

      const updateCount = buffer.readUInt32LE(0)
      const lastUpdatedAt = buffer.readDoubleBE(4)
      const hidden = new Float32Array(
        buffer.buffer.slice(buffer.byteOffset + 12, buffer.byteOffset + 12 + HIDDEN_DIM * 4),
      )

      const key = `${agentId}:${mode}`
      this.states.set(key, { hidden, lastUpdatedAt, updateCount })

      logger.debug(`RNN 隐状态已恢复: ${filePath} (updates=${updateCount})`)
      return true
    } catch (err) {
      logger.warn(`RNN 隐状态恢复失败: ${filePath}`, { error: err })
      return false
    }
  }

  /**
   * 保存所有状态 + 权重
   */
  saveAll(): void {
    for (const key of this.states.keys()) {
      const [agentId, mode] = key.split(':') as [string, string]
      this.save(agentId, mode)
    }
    this.saveWeights()
    this.saveMinGruWeights()
    logger.info(`ContextRNN: 所有状态已保存 (${this.states.size} 个 Agent)`)
  }

  /**
   * 获取统计信息
   */
  getStats(): Array<{ agentId: string; mode: string; updateCount: number; lastUpdatedAt: number }> {
    const stats: Array<{
      agentId: string
      mode: string
      updateCount: number
      lastUpdatedAt: number
    }> = []
    for (const [key, state] of this.states) {
      const [agentId, mode] = key.split(':') as [string, string]
      stats.push({
        agentId,
        mode,
        updateCount: state.updateCount,
        lastUpdatedAt: state.lastUpdatedAt,
      })
    }
    return stats
  }

  /**
   * CCSA: W_out 在线 SGD 更新
   *
   * 基于反馈信号调整 W_out 矩阵，让 generateBias 产生的 diffusion bias
   * 更好地引导图扩散方向。
   *
   * 核心梯度:
   * - positive (bias 方向好): 减小 ‖bias - target_embedding‖² → W_out 向 target 方向移动
   * - negative (bias 方向差): 增大 ‖bias - target_embedding‖² → W_out 远离 target 方向
   *
   * 更新规则: W_out -= lr × gradient
   * gradient = (bias - target) ⊗ h_t  (positive)
   * gradient = -(bias - target) ⊗ h_t  (negative，即推离)
   *
   * @param hiddenState  该轮对话的 h_t (256 维)
   * @param contextBias  该轮的 diffusion bias = W_out · h_t (1536 维)
   * @param targetEmbedding  被采纳/拒绝的记忆的 embedding (1536 维)
   * @param isPositive  反馈信号：true = 该方向好，false = 该方向差
   * @param learningRate  学习率 (默认 0.0005，小于 GRU 的 0.001 以保持稳定)
   */
  updateOutputWeights(
    hiddenState: Float32Array,
    contextBias: Float32Array,
    targetEmbedding: Float32Array,
    isPositive: boolean,
    learningRate: number = 0.0005,
  ): void {
    const sign = isPositive ? 1.0 : -1.0

    // 梯度: 对每个 W_out[j][i]，梯度 = (bias[i] - target[i]) * h[j]
    // positive 时沿梯度下降，negative 时沿梯度上升
    for (let j = 0; j < HIDDEN_DIM; j++) {
      const hj = hiddenState[j]!
      if (Math.abs(hj) < 1e-8) continue // 跳过零激活的隐单元

      for (let i = 0; i < INPUT_DIM; i++) {
        const diff = contextBias[i]! - targetEmbedding[i]!
        const grad = sign * diff * hj
        // SGD 更新 + 梯度裁剪（防止 Xavier 初始化早期的大梯度）
        const clippedGrad = Math.max(-0.1, Math.min(0.1, grad))
        this.outputMatrix[j * INPUT_DIM + i]! -= learningRate * clippedGrad
      }
    }
  }

  /**
   * minGRU 内部权重在线训练（AIOS 第八阶段新增）
   *
   * 基于反馈信号更新 W_z/b_z/W_h/b_h，让 minGRU 的循环动力学
   * 更好地编码"对话轨迹 → 有效记忆检索"的映射。
   *
   * 训练信号来源与 updateOutputWeights 相同：
   * - positive（记忆被采纳）: label=1.0，强化当前隐状态方向
   * - negative（记忆被拒绝）: label=0.0，抑制当前隐状态方向
   *
   * @param agentId   Agent ID
   * @param mode      模式
   * @param queryEmbedding 原始 query embedding（会先投影到 HIDDEN_DIM）
   * @param isPositive 反馈信号：true=正面，false=负面
   * @param learningRate 学习率（默认 0.001）
   * @returns 训练损失值
   */
  trainMinGru(
    agentId: string,
    mode: string,
    queryEmbedding: Float32Array,
    isPositive: boolean,
    learningRate: number = 0.001,
  ): number {
    const state = this.getOrCreateState(agentId, mode)

    // 投影到 HIDDEN_DIM
    const projected = projectInput(queryEmbedding, this.projMatrix)

    // 单步 SGD 训练（原地更新 minGruWeights）
    const label = isPositive ? 1.0 : 0.0
    const loss = trainMinGruStep(state.hidden, projected, this.minGruWeights, label, learningRate)

    logger.debug(`minGRU 训练: loss=${loss.toFixed(4)}, label=${label}`)
    return loss
  }

  // ── 内部方法 ──

  private getOrCreateState(agentId: string, mode: string): RnnState {
    const key = `${agentId}:${mode}`
    let state = this.states.get(key)
    if (state) return state

    // 尝试从磁盘恢复
    if (this.load(agentId, mode)) {
      return this.states.get(key)!
    }

    // 新建零初始化隐状态
    state = {
      hidden: new Float32Array(HIDDEN_DIM), // 零初始化
      lastUpdatedAt: Date.now(),
      updateCount: 0,
    }
    this.states.set(key, state)
    return state
  }

  private resolveStatePath(agentId: string, mode: string): string {
    return this.pathResolver.resolve(`@data/agent_${agentId}/rnn_${mode}.bin`)
  }

  private resolveWeightsPath(name: string): string {
    return this.pathResolver.resolve(`@data/shared/rnn_${name}.bin`)
  }

  private loadOrInitWeights(
    name: string,
    size: number,
    fanIn: number,
    fanOut: number,
  ): Float32Array {
    const filePath = this.resolveWeightsPath(name)
    if (existsSync(filePath)) {
      try {
        const buffer = readFileSync(filePath)
        if (buffer.length === size * 4) {
          logger.debug(`RNN 权重已加载: ${name} (${size} 元素)`)
          return new Float32Array(
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          )
        }
      } catch {
        /* fallthrough to init */
      }
    }

    // Xavier 均匀初始化
    logger.info(`RNN 权重 Xavier 初始化: ${name} (fanIn=${fanIn}, fanOut=${fanOut})`)
    return xavierUniform(fanIn, fanOut, size)
  }

  private saveWeights(): void {
    const dir = path.dirname(this.resolveWeightsPath('proj'))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    writeFileSync(this.resolveWeightsPath('proj'), Buffer.from(this.projMatrix.buffer))
    writeFileSync(this.resolveWeightsPath('output'), Buffer.from(this.outputMatrix.buffer))
    logger.debug('RNN 权重已保存')
  }

  /**
   * 加载或初始化 minGRU 内部权重（AIOS 第八阶段新增）
   *
   * 权重文件格式: [wZ | bZ | wH | bH] 拼接为单个 Float32 buffer
   * 总大小: (W_Z + B_Z + W_H + B_H) × 4 字节 ≈ 514KB
   *
   * 如果文件不存在或损坏，使用 xavierInitMinGruWeights 初始化：
   * - W_z/W_h: Xavier 均匀分布
   * - b_z/b_h: 0.1（确保门控初始开度合理，不再是 0）
   */
  private loadOrInitMinGruWeights(): MinGruWeights {
    const filePath = this.resolveWeightsPath('mingru')
    const totalSize = MIN_GRU_WEIGHT_SIZES.TOTAL

    if (existsSync(filePath)) {
      try {
        const buffer = readFileSync(filePath)
        if (buffer.length === totalSize * 4) {
          const float32 = new Float32Array(
            buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          )
          // 按布局切分: [wZ | bZ | wH | bH]
          const wZSize = MIN_GRU_WEIGHT_SIZES.W_Z
          const bZSize = MIN_GRU_WEIGHT_SIZES.B_Z
          const wHSize = MIN_GRU_WEIGHT_SIZES.W_H

          const wZ = float32.slice(0, wZSize)
          const bZ = float32.slice(wZSize, wZSize + bZSize)
          const wH = float32.slice(wZSize + bZSize, wZSize + bZSize + wHSize)
          const bH = float32.slice(wZSize + bZSize + wHSize, totalSize)

          logger.info(`minGRU 权重已加载: ${filePath} (${totalSize} 元素)`)
          return { wZ, bZ, wH, bH }
        }
        logger.warn(`minGRU 权重文件大小不匹配: 期望 ${totalSize * 4}, 实际 ${buffer.length}`)
      } catch (err) {
        logger.warn(`minGRU 权重加载失败: ${filePath}`, { error: err })
      }
    }

    // Xavier 初始化（偏置 0.1，不再是 0）
    logger.info(`minGRU 权重 Xavier 初始化 (W_z/W_h: Xavier, b_z/b_h: 0.1)`)
    return xavierInitMinGruWeights(HIDDEN_DIM)
  }

  /**
   * 保存 minGRU 内部权重到磁盘
   *
   * 将 [wZ | bZ | wH | bH] 拼接为单个 buffer 写入 rnn_mingru.bin
   */
  private saveMinGruWeights(): void {
    const dir = path.dirname(this.resolveWeightsPath('mingru'))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const { wZ, bZ, wH, bH } = this.minGruWeights
    // 拼接为单个 buffer
    const total = MIN_GRU_WEIGHT_SIZES.TOTAL
    const combined = new Float32Array(total)
    let offset = 0
    combined.set(wZ, offset)
    offset += wZ.length
    combined.set(bZ, offset)
    offset += bZ.length
    combined.set(wH, offset)
    offset += wH.length
    combined.set(bH, offset)

    writeFileSync(this.resolveWeightsPath('mingru'), Buffer.from(combined.buffer))
    logger.debug('minGRU 权重已保存')
  }
}

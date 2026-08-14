/**
 * @infos/nit-runtime — 自动加载器
 *
 * 优先加载 Rust N-API 编译产物 (.node)，失败时 fallback 到 TS mock。
 *
 * 加载优先级:
 * 1. 同目录的 index.win32-x64-msvc.node (或对应平台)
 * 2. 内置的 TS fallback 实现
 *
 * @module @infos/nit-runtime
 */

import { join } from 'node:path'

// ─────────────────────────────────────────────
// 类型定义 (Rust 侧和 TS mock 共用)
// ─────────────────────────────────────────────

export const HIDDEN_DIM = 256

/**
 * minGRU 内部权重各分量大小
 *
 * AIOS 第八阶段：将权重管理从 Rust 全局单例移到 TS 侧，实现持久化和训练。
 *
 * 权重布局（行优先）:
 *   W_z[HIDDEN_DIM × HIDDEN_DIM] — 门控权重矩阵
 *   b_z[HIDDEN_DIM]              — 门控偏置
 *   W_h[HIDDEN_DIM × HIDDEN_DIM] — 候选状态权重矩阵
 *   b_h[HIDDEN_DIM]              — 候选状态偏置
 */
export const MIN_GRU_WEIGHT_SIZES = {
  /** 门控权重 W_z (256×256) */
  W_Z: HIDDEN_DIM * HIDDEN_DIM,
  /** 门控偏置 b_z (256) */
  B_Z: HIDDEN_DIM,
  /** 候选状态权重 W_h (256×256) */
  W_H: HIDDEN_DIM * HIDDEN_DIM,
  /** 候选状态偏置 b_h (256) */
  B_H: HIDDEN_DIM,
  /** 总元素数 (131584 ≈ 514KB f32) */
  TOTAL: HIDDEN_DIM * HIDDEN_DIM * 2 + HIDDEN_DIM * 2,
} as const

/** minGRU 权重包（TS 侧管理，可持久化） */
export interface MinGruWeights {
  /** 门控权重 W_z (HIDDEN_DIM × HIDDEN_DIM) */
  wZ: Float32Array
  /** 门控偏置 b_z (HIDDEN_DIM) */
  bZ: Float32Array
  /** 候选状态权重 W_h (HIDDEN_DIM × HIDDEN_DIM) */
  wH: Float32Array
  /** 候选状态偏置 b_h (HIDDEN_DIM) */
  bH: Float32Array
}

export interface TrainingSample {
  hiddenState: Float32Array
  queryEmbedding: Float32Array
  label: number
}

export interface ClusterResult {
  nodeToCluster: Map<number, number>
  clusterLabels: Map<number, string>
  centroids: Map<number, Float32Array>
}

// ─────────────────────────────────────────────
// Native 模块接口
// ─────────────────────────────────────────────

interface NativeModule {
  HIDDEN_DIM: number
  minGruForward(hidden: Float32Array, input: Float32Array): Float32Array
  projectInput(queryEmbedding: Float32Array, projMatrix: Float32Array): Float32Array
  minGruTrain(samples: TrainingSample[], learningRate?: number): number
  leidenCluster(): { nodeToCluster: number[]; clusterLabels: string[]; centroids: number[] }
  executeAst(): never
}

// ─────────────────────────────────────────────
// 自动加载: Rust native → TS fallback
// ─────────────────────────────────────────────

let native: NativeModule | null = null
let usingNative = false

try {
  // 探测 napi-rs 编译产物
  const platform = process.platform
  const arch = process.arch
  const abiMap: Record<string, string> = {
    'win32-x64': 'win32-x64-msvc',
    'linux-x64': 'linux-x64-gnu',
    'darwin-x64': 'darwin-x64',
    'darwin-arm64': 'darwin-arm64',
    'linux-arm64': 'linux-arm64-gnu',
  }
  const abi = abiMap[`${platform}-${arch}`]
  if (abi) {
    const nodePath = join(__dirname, `index.${abi}.node`)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    native = require(nodePath) as NativeModule
    usingNative = true
    console.log(`[nit-runtime] ✅ Rust N-API 已加载: ${abi} (${nodePath})`)
  }
} catch {
  // Rust 编译产物不存在, 使用 TS fallback
}

if (!usingNative) {
  console.log('[nit-runtime] ⚠️ Rust N-API 不可用, 使用 TS fallback')
}

/** 是否正在使用 Rust native 后端 */
export const isNative = usingNative

// ─────────────────────────────────────────────
// TS fallback 实现
// ─────────────────────────────────────────────

/**
 * Xavier 均匀分布初始化（TS 侧，供 minGRU 权重使用）
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

/**
 * 初始化 minGRU 权重包（Xavier 初始化 W_z/W_h，偏置初始化为小正值）
 *
 * AIOS 第八阶段：偏置不再初始化为 0，而是用小的正值（0.1），
 * 确保 sigmoid 门控初始时有合理的开度（~0.525），避免梯度消失。
 *
 * @param hiddenDim 隐状态维度（默认 HIDDEN_DIM）
 */
export function xavierInitMinGruWeights(hiddenDim: number = HIDDEN_DIM): MinGruWeights {
  return {
    wZ: xavierUniform(hiddenDim, hiddenDim, hiddenDim * hiddenDim),
    // 偏置初始化为 0.1，确保门控初始开度合理（σ(0.1) ≈ 0.525）
    bZ: new Float32Array(hiddenDim).fill(0.1),
    wH: xavierUniform(hiddenDim, hiddenDim, hiddenDim * hiddenDim),
    bH: new Float32Array(hiddenDim).fill(0.1),
  }
}

/**
 * minGRU 前向推理（带权重版）
 *
 * AIOS 第八阶段：正规 GRU 实现，权重由 TS 侧管理，可持久化可训练。
 *
 * 公式（minGRU 论文 "Were RNNs All We Needed?"）:
 *   z_t = σ(W_z @ x_t + b_z)           — 门控
 *   h̃_t = W_h @ x_t + b_h              — 候选状态
 *   h_{t+1} = (1 - z_t) ⊙ h_t + z_t ⊙ h̃_t  — 状态混合
 *
 * @param hidden  当前隐状态 (HIDDEN_DIM 维)
 * @param input   投影后的查询向量 (HIDDEN_DIM 维)
 * @param weights minGRU 权重包 (wZ, bZ, wH, bH)
 * @returns 更新后的隐状态 (HIDDEN_DIM 维)
 */
export function minGruForwardWithWeights(
  hidden: Float32Array,
  input: Float32Array,
  weights: MinGruWeights,
): Float32Array {
  const dim = hidden.length
  const { wZ, bZ, wH, bH } = weights
  const result = new Float32Array(dim)

  for (let i = 0; i < dim; i++) {
    // z_t[i] = σ(W_z[i,:] · x + b_z[i])
    let zSum = bZ[i]!
    for (let j = 0; j < dim; j++) {
      zSum += wZ[i * dim + j]! * input[j]!
    }
    const z = 1.0 / (1.0 + Math.exp(-zSum))

    // h̃_t[i] = W_h[i,:] · x + b_h[i]
    let hSum = bH[i]!
    for (let j = 0; j < dim; j++) {
      hSum += wH[i * dim + j]! * input[j]!
    }

    // h_{t+1}[i] = (1 - z) * h_t[i] + z * h̃_t[i]
    result[i] = (1.0 - z) * hidden[i]! + z * hSum
  }

  return result
}

/**
 * minGRU 单步 SGD 训练
 *
 * AIOS 第八阶段：将 Rust 侧 train() 移植到 TS，实现偏置和权重的在线学习。
 *
 * 训练目标: 二分类交叉熵
 *   p = σ(mean(h_new))           — 将隐状态投影为标量概率
 *   L = -[y·log(p) + (1-y)·log(1-p)]  — BCE 损失
 *
 * 反向传播:
 *   dp = -y/(p+ε) + (1-y)/(1-p+ε)
 *   dh_mean = dp · p · (1-p)
 *   dh_scale = dh_mean / HIDDEN_DIM
 *   对每个 i:
 *     dz_i = dh_scale · (h̃_i - h_i)
 *     dz_pre_i = dz_i · z_i · (1-z_i)   — sigmoid 导数
 *     dh_cand_i = dh_scale · z_i
 *     grad_W_z[i,j] += dz_pre_i · x_j
 *     grad_W_h[i,j] += dh_cand_i · x_j
 *     grad_b_z[i] += dz_pre_i
 *     grad_b_h[i] += dh_cand_i
 *
 * 注意：权重数组会被原地修改（mutate in-place），无需返回新数组。
 *
 * @param hidden      该轮对话的隐状态 h_t
 * @param input       投影后的查询向量 x_t
 * @param weights     minGRU 权重包（会被原地更新）
 * @param label       反馈标签 (1.0 = 正面/相关, 0.0 = 负面/不相关)
 * @param learningRate 学习率 (默认 0.001)
 * @returns 训练损失值
 */
export function trainMinGruStep(
  hidden: Float32Array,
  input: Float32Array,
  weights: MinGruWeights,
  label: number,
  learningRate: number = 0.001,
): number {
  const dim = hidden.length
  const { wZ, bZ, wH, bH } = weights

  // ── 前向传播 ──
  const z = new Float32Array(dim)
  const hCand = new Float32Array(dim)
  const hNew = new Float32Array(dim)

  for (let i = 0; i < dim; i++) {
    // z_t[i] = σ(W_z[i,:] · x + b_z[i])
    let zSum = bZ[i]!
    for (let j = 0; j < dim; j++) {
      zSum += wZ[i * dim + j]! * input[j]!
    }
    z[i] = 1.0 / (1.0 + Math.exp(-zSum))

    // h̃_t[i] = W_h[i,:] · x + b_h[i]
    let hSum = bH[i]!
    for (let j = 0; j < dim; j++) {
      hSum += wH[i * dim + j]! * input[j]!
    }
    hCand[i] = hSum

    // h_new[i] = (1 - z) * h + z * h̃
    hNew[i] = (1.0 - z[i]!) * hidden[i]! + z[i]! * hCand[i]!
  }

  // ── 损失计算 ──
  // p = σ(mean(h_new))
  let hMean = 0
  for (let i = 0; i < dim; i++) hMean += hNew[i]!
  hMean /= dim
  const p = 1.0 / (1.0 + Math.exp(-hMean))

  // BCE 损失: L = -[y·log(p) + (1-y)·log(1-p)]
  const eps = 1e-7
  const loss = -(label * Math.log(p + eps) + (1.0 - label) * Math.log(1.0 - p + eps))

  // ── 反向传播 ──
  const dp = -label / (p + eps) + (1.0 - label) / (1.0 - p + eps)
  const dhMean = dp * p * (1.0 - p)
  const dhScale = dhMean / dim

  for (let i = 0; i < dim; i++) {
    const dz = dhScale * (hCand[i]! - hidden[i]!)
    const dzPre = dz * z[i]! * (1.0 - z[i]!)
    const dhCand = dhScale * z[i]!

    // 梯度裁剪（防止早期大梯度）
    const clippedDzPre = Math.max(-0.1, Math.min(0.1, dzPre))
    const clippedDhCand = Math.max(-0.1, Math.min(0.1, dhCand))

    // 更新 W_z[i,:] 和 W_h[i,:]
    for (let j = 0; j < dim; j++) {
      wZ[i * dim + j]! -= learningRate * clippedDzPre * input[j]!
      wH[i * dim + j]! -= learningRate * clippedDhCand * input[j]!
    }
    // 更新偏置 b_z[i] 和 b_h[i]
    bZ[i]! -= learningRate * clippedDzPre
    bH[i]! -= learningRate * clippedDhCand
  }

  return loss
}

function tsFallback_minGruForward(hidden: Float32Array, input: Float32Array): Float32Array {
  const dim = hidden.length
  const result = new Float32Array(dim)
  for (let i = 0; i < dim; i++) {
    const z = 1 / (1 + Math.exp(-input[i]!))
    const hCandidate = Math.tanh(input[i]!)
    result[i] = (1 - z) * hidden[i]! + z * hCandidate
  }
  return result
}

function tsFallback_projectInput(
  queryEmbedding: Float32Array,
  projMatrix: Float32Array,
): Float32Array {
  const inputDim = queryEmbedding.length
  const result = new Float32Array(HIDDEN_DIM)
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let sum = 0
    for (let i = 0; i < inputDim; i++) {
      sum += queryEmbedding[i]! * projMatrix[i * HIDDEN_DIM + j]!
    }
    result[j] = sum
  }
  return result
}

function tsFallback_minGruTrain(_samples: TrainingSample[], _learningRate: number): number {
  console.warn('[nit-runtime] minGruTrain: TS mock 无训练能力，跳过')
  return 0
}

// ─────────────────────────────────────────────
// 统一导出 (自动选择 native / fallback)
// ─────────────────────────────────────────────

/**
 * minGRU 前向推理
 *
 * Rust 版: 使用 W_z, b_z, W_h, b_h 权重矩阵，<2ms
 * TS fallback: 简化版 sigmoid+tanh 门控
 */
export function minGruForward(hidden: Float32Array, input: Float32Array): Float32Array {
  if (native) return native.minGruForward(hidden, input)
  return tsFallback_minGruForward(hidden, input)
}

/**
 * 投影输入向量到隐状态空间
 *
 * Rust 版: 优化的矩阵乘法
 * TS fallback: 朴素矩阵乘法
 */
export function projectInput(queryEmbedding: Float32Array, projMatrix: Float32Array): Float32Array {
  if (native) return native.projectInput(queryEmbedding, projMatrix)
  return tsFallback_projectInput(queryEmbedding, projMatrix)
}

/**
 * minGRU 在线微调 (SGD)
 *
 * Rust 版: 完整的交叉熵损失 + 反向传播, <10ms
 * TS fallback: noop (无训练能力)
 */
export function minGruTrain(samples: TrainingSample[], learningRate: number = 0.001): number {
  if (native) return native.minGruTrain(samples, learningRate)
  return tsFallback_minGruTrain(samples, learningRate)
}

/**
 * Leiden 社区发现算法
 *
 * 空 API 占位 — 等 TriviumDB 原生支持
 */
export function leidenCluster(
  _adjacency: Map<number, Array<{ target: number; weight: number }>>,
): ClusterResult {
  return {
    nodeToCluster: new Map(),
    clusterLabels: new Map(),
    centroids: new Map(),
  }
}

/**
 * NIT AST 执行 (预留接口)
 */
export function executeAst(_ast: unknown): unknown {
  throw new Error('[nit-runtime] executeAst: 请使用 TS 版 NIT runtime')
}

/**
 * @perocore/nit-runtime — 自动加载器
 *
 * 优先加载 Rust N-API 编译产物 (.node)，失败时 fallback 到 TS mock。
 *
 * 加载优先级:
 * 1. 同目录的 index.win32-x64-msvc.node (或对应平台)
 * 2. 内置的 TS fallback 实现
 *
 * @module @perocore/nit-runtime
 */

import { join } from 'node:path'

// ─────────────────────────────────────────────
// 类型定义 (Rust 侧和 TS mock 共用)
// ─────────────────────────────────────────────

export const HIDDEN_DIM = 256

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

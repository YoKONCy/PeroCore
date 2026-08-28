/**
 * minGru — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
export const HIDDEN_DIM = 256

export const MIN_GRU_WEIGHT_SIZES = {
  W_Z: HIDDEN_DIM * HIDDEN_DIM,
  B_Z: HIDDEN_DIM,
  W_H: HIDDEN_DIM * HIDDEN_DIM,
  B_H: HIDDEN_DIM,
  TOTAL: HIDDEN_DIM * HIDDEN_DIM * 2 + HIDDEN_DIM * 2,
} as const

export interface MinGruWeights {
  wZ: Float32Array
  bZ: Float32Array
  wH: Float32Array
  bH: Float32Array
}

function xavierUniform(fanIn: number, fanOut: number, size: number): Float32Array {
  const limit = Math.sqrt(6 / (fanIn + fanOut))
  const values = new Float32Array(size)
  for (let index = 0; index < size; index++) {
    values[index] = (Math.random() * 2 - 1) * limit
  }
  return values
}

export function xavierInitMinGruWeights(hiddenDim = HIDDEN_DIM): MinGruWeights {
  return {
    wZ: xavierUniform(hiddenDim, hiddenDim, hiddenDim * hiddenDim),
    bZ: new Float32Array(hiddenDim).fill(0.1),
    wH: xavierUniform(hiddenDim, hiddenDim, hiddenDim * hiddenDim),
    bH: new Float32Array(hiddenDim).fill(0.1),
  }
}

export function projectInput(
  queryEmbedding: Float32Array,
  projectionMatrix: Float32Array,
): Float32Array {
  const result = new Float32Array(HIDDEN_DIM)
  for (let output = 0; output < HIDDEN_DIM; output++) {
    let sum = 0
    for (let input = 0; input < queryEmbedding.length; input++) {
      sum += queryEmbedding[input]! * projectionMatrix[input * HIDDEN_DIM + output]!
    }
    result[output] = sum
  }
  return result
}

export function minGruForwardWithWeights(
  hidden: Float32Array,
  input: Float32Array,
  weights: MinGruWeights,
): Float32Array {
  const result = new Float32Array(hidden.length)
  for (let row = 0; row < hidden.length; row++) {
    let gateSum = weights.bZ[row]!
    let candidate = weights.bH[row]!
    for (let column = 0; column < hidden.length; column++) {
      gateSum += weights.wZ[row * hidden.length + column]! * input[column]!
      candidate += weights.wH[row * hidden.length + column]! * input[column]!
    }
    const gate = 1 / (1 + Math.exp(-gateSum))
    result[row] = (1 - gate) * hidden[row]! + gate * candidate
  }
  return result
}

export function trainMinGruStep(
  hidden: Float32Array,
  input: Float32Array,
  weights: MinGruWeights,
  label: number,
  learningRate = 0.001,
): number {
  const dimension = hidden.length
  const gates = new Float32Array(dimension)
  const candidates = new Float32Array(dimension)
  const next = new Float32Array(dimension)

  for (let row = 0; row < dimension; row++) {
    let gateSum = weights.bZ[row]!
    let candidate = weights.bH[row]!
    for (let column = 0; column < dimension; column++) {
      gateSum += weights.wZ[row * dimension + column]! * input[column]!
      candidate += weights.wH[row * dimension + column]! * input[column]!
    }
    gates[row] = 1 / (1 + Math.exp(-gateSum))
    candidates[row] = candidate
    next[row] = (1 - gates[row]!) * hidden[row]! + gates[row]! * candidate
  }

  let mean = 0
  for (const value of next) mean += value
  mean /= dimension
  const probability = 1 / (1 + Math.exp(-mean))
  const epsilon = 1e-7
  const loss = -(
    label * Math.log(probability + epsilon) +
    (1 - label) * Math.log(1 - probability + epsilon)
  )
  const derivative =
    ((-label / (probability + epsilon) + (1 - label) / (1 - probability + epsilon)) *
      probability *
      (1 - probability)) /
    dimension

  for (let row = 0; row < dimension; row++) {
    const gateGradient = Math.max(
      -0.1,
      Math.min(
        0.1,
        derivative * (candidates[row]! - hidden[row]!) * gates[row]! * (1 - gates[row]!),
      ),
    )
    const candidateGradient = Math.max(-0.1, Math.min(0.1, derivative * gates[row]!))
    for (let column = 0; column < dimension; column++) {
      weights.wZ[row * dimension + column]! -= learningRate * gateGradient * input[column]!
      weights.wH[row * dimension + column]! -= learningRate * candidateGradient * input[column]!
    }
    weights.bZ[row]! -= learningRate * gateGradient
    weights.bH[row]! -= learningRate * candidateGradient
  }
  return loss
}

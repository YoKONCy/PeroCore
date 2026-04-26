/**
 * @perocore/nit-runtime 类型声明
 *
 * 对外暴露的类型无论 native 还是 TS fallback 都一致。
 */

export declare const HIDDEN_DIM: 256

/** 是否正在使用 Rust N-API 后端 */
export declare const isNative: boolean

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

export declare function minGruForward(hidden: Float32Array, input: Float32Array): Float32Array

export declare function projectInput(
  queryEmbedding: Float32Array,
  projMatrix: Float32Array,
): Float32Array

export declare function minGruTrain(samples: TrainingSample[], learningRate?: number): number

export declare function leidenCluster(
  adjacency: Map<number, Array<{ target: number; weight: number }>>,
): ClusterResult

export declare function executeAst(ast: unknown): unknown

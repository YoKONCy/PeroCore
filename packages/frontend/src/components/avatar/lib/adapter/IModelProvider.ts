/**
 * 模型提供者接口
 *
 * 定义从不同数据源（JSON / .pero / Blockbench）获取统一模型数据的抽象层。
 * 所有 Provider 实现必须将原始格式转换为标准的 ParsedModelData 结构。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/IModelProvider
 */

import type * as THREE from 'three'
import type { IAvatarManifest } from './IAvatarManifest'

/**
 * 统一的模型数据结构
 *
 * 对应 Rust Native 模块 (`@infos/render-core`) 输出的 `ParsedModelData`。
 */
export interface ParsedModelData {
  /** 纹理图集宽度（像素） */
  textureWidth: number
  /** 纹理图集高度（像素） */
  textureHeight: number
  /** 骨骼数据数组 */
  bones: ParsedBone[]
}

/** 解析后的骨骼数据 */
export interface ParsedBone {
  /** 骨骼名称 */
  name: string
  /** 父级骨骼名称（顶层骨骼为 undefined） */
  parent?: string
  /** 基准点 [x, y, z] */
  pivot: [number, number, number]
  /** 初始旋转 [x, y, z] */
  rotation?: [number, number, number]
  /** 预计算顶点数据（来自 Rust Native） */
  vertices?: Float32Array
  /** 预计算 UV 数据（来自 Rust Native） */
  uvs?: Float32Array
  /** 预计算索引数据（来自 Rust Native） */
  indices?: Uint16Array
  /** 原始 Cube 数据（用于未预计算几何体的情况） */
  cubes?: Record<string, unknown>[]
  /** Rust 返回的 JSON 字符串形式的 Cube 数据 */
  cubesJson?: string
}

/**
 * 模型提供者接口
 *
 * 负责从不同来源获取模型几何体、纹理和动画数据，
 * 输出标准化的数据结构供 AvatarRenderer 消费。
 */
export interface IModelProvider {
  /** 获取模型清单/元数据 */
  getManifest(): Promise<Partial<IAvatarManifest>>

  /** 获取解析后的几何数据 */
  getModelData(): Promise<ParsedModelData>

  /** 获取纹理贴图 */
  getTexture(): Promise<THREE.Texture>

  /** 获取动画数据映射 (Key = 动画名称) */
  getAnimations(): Promise<Map<string, unknown>>

  /** 获取动画控制器数据映射（可选） */
  getAnimationControllers?(): Promise<Map<string, unknown>>
}

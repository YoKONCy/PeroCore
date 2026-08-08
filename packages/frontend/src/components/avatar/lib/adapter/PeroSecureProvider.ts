/**
 * 加密模型提供者 (.pero 单文件格式)
 *
 * 通过 Electron IPC 调用 Rust Native 模块 (@perocore/render-core)
 * 解密和解析 .pero 加密模型文件。密钥在 Rust 内部管理，
 * JS 层无法拦截，确保资产安全。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/PeroSecureProvider
 */

import * as THREE from 'three'
import { logger } from '../../../../lib/logger'
import type { IModelProvider, ParsedModelData } from './IModelProvider'
import type { IAvatarManifest } from './IAvatarManifest'
// Provider 接收到的路径已经是可直接 fetch 的 URL，无需额外转换

// ══════ 类型定义 ══════

/** 模型加载配置 */
interface SecureModelConfig {
  name: string
  model: string
  texture: string
  animation?: string[]
}

/** Electron 窗口扩展 — .pero 解密 API */
interface ElectronWindow {
  electron?: {
    loadPeroModel?: (data: Uint8Array, filters?: string[]) => Promise<ParsedModelData>
  }
}

// ══════ Provider ══════

/**
 * 加密模型提供者
 *
 * 处理 .pero 单文件加密格式（XChaCha20-Poly1305 加密）。
 * 必须在 Electron 环境下运行，纯 Web 环境无法使用。
 */
export class PeroSecureProvider implements IModelProvider {
  private config: SecureModelConfig
  private textureCache = new Map<string, THREE.Texture>()
  private boneFilterPatterns: string[] | undefined

  constructor(config: SecureModelConfig, boneFilterPatterns?: string[]) {
    this.config = config
    this.boneFilterPatterns = boneFilterPatterns
  }

  async getManifest(): Promise<Partial<IAvatarManifest>> {
    return {
      metadata: {
        name: this.config.name,
        version: '1.0.0',
      },
    }
  }

  async getModelData(): Promise<ParsedModelData> {
    const modelUrl = this.config.model
    if (!modelUrl) throw new Error('模型路径未在配置中提供')

    // 获取加密的二进制数据
    const url = modelUrl
    const response = await fetch(url)
    if (!response.ok) throw new Error(`加载加密模型失败: ${modelUrl}`)
    const arrayBuffer = await response.arrayBuffer()

    // 通过 Electron IPC 调用 Rust Native 解密并解析
    // 密钥在 Rust 内部管理，JS 层不可见
    const electronWin = window as unknown as ElectronWindow
    if (!electronWin.electron?.loadPeroModel) {
      throw new Error('加密模型需要 Electron 环境（Rust Native 模块）')
    }

    const parsedData = await electronWin.electron.loadPeroModel(
      new Uint8Array(arrayBuffer),
      this.boneFilterPatterns,
    )

    return parsedData
  }

  async getTexture(): Promise<THREE.Texture> {
    const originalUrl = this.config.texture
    if (!originalUrl) throw new Error('纹理路径未在配置中提供')

    const url = originalUrl
    if (this.textureCache.has(url)) {
      return this.textureCache.get(url)!
    }

    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (t) => {
          t.magFilter = THREE.NearestFilter
          t.minFilter = THREE.NearestFilter
          t.colorSpace = THREE.SRGBColorSpace
          this.textureCache.set(url, t)
          resolve(t)
        },
        undefined,
        reject,
      )
    })
  }

  async getAnimations(): Promise<Map<string, unknown>> {
    const animations = new Map<string, unknown>()

    if (this.config.animation && Array.isArray(this.config.animation)) {
      for (const path of this.config.animation) {
        try {
          const url = path
          const res = await fetch(url)
          const json = await res.json()
          if (json.animations) {
            Object.entries(json.animations).forEach(([key, value]) => {
              animations.set(key, value)
            })
          }
        } catch (e) {
          logger.warn('PeroSecureProvider', `加载动画失败: ${path}`, e)
        }
      }
    }

    return animations
  }
}

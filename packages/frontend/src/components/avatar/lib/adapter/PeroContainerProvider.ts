/**
 * .pero 容器提供者
 *
 * 加载加密的 tar 打包文件夹（.pero 容器格式），
 * 包含模型、纹理、动画和控制器等所有资源。
 * 通过 Electron IPC 调用 Rust Native 解密后全部在内存中操作，
 * 无需解压到磁盘。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/PeroContainerProvider
 */

import * as THREE from 'three'
import { logger } from '../../../../lib/logger'
import type { IModelProvider, ParsedModelData } from './IModelProvider'
// Provider 接收到的路径已经是可直接 fetch 的 URL，无需额外转换

// ══════ 类型定义 ══════

/** 容器内文件 — 对应 Rust Native 模块输出的 PeroContainerFile */
export interface PeroContainerFile {
  /** 相对路径 */
  path: string
  /** 文件数据 */
  data: Uint8Array
}

/** 解密后的容器 — 对应 Rust Native 模块输出的 PeroContainer */
export interface PeroContainer {
  /** 容器内所有文件 */
  files: PeroContainerFile[]
}

/** Electron 窗口扩展 — 容器解密 API */
interface ElectronWindow {
  electron?: {
    loadPeroContainer?: (data: Uint8Array) => Promise<PeroContainer>
    loadStandardModel?: (data: Uint8Array, filters?: string[]) => Promise<ParsedModelData>
  }
}

// ══════ Provider ══════

/**
 * .pero 容器提供者
 *
 * 处理 tar 打包的加密文件夹格式。
 * 必须在 Electron 环境下运行以访问 Rust Native 解密能力。
 */
export class PeroContainerProvider implements IModelProvider {
  private containerUrl: string
  private boneFilterPatterns?: string[]
  /** 容器内文件映射 (Key = 小写规范化路径) */
  private files = new Map<string, Uint8Array>()
  private loaded = false
  private textureCache = new Map<string, THREE.Texture>()

  constructor(containerUrl: string, boneFilterPatterns?: string[]) {
    this.containerUrl = containerUrl
    this.boneFilterPatterns = boneFilterPatterns
  }

  // ══════ IModelProvider 接口实现 ══════

  async getManifest(): Promise<Record<string, unknown>> {
    await this.ensureLoaded()

    // 尝试查找 manifest 文件
    const manifestData = this.findFile(['manifest.json', 'model.json'])
    if (manifestData) {
      try {
        const text = new TextDecoder().decode(manifestData)
        return JSON.parse(text)
      } catch (e) {
        logger.warn('PeroContainer', '解析 manifest 失败', e)
      }
    }

    // 返回默认 manifest
    return {
      name: 'PeroContainer',
      version: '3.0.0',
      secure: true,
      format: 'tar-container',
    }
  }

  async getModelData(): Promise<ParsedModelData> {
    await this.ensureLoaded()

    // 查找模型文件（优先 models/ 目录下的 main.json）
    const modelData =
      this.findFile(['models/main.json', 'main.json', '.geo.json', 'model.json']) ||
      this.findFile(['.json']) // 兜底

    if (!modelData) {
      logger.error('PeroContainer', '容器内未找到模型文件', Array.from(this.files.keys()))
      throw new Error('[PeroContainer] 容器内未找到模型文件')
    }

    // 使用 Rust Native 解析标准模型数据（几何体/UV/镜像等复杂逻辑）
    const electronWin = window as unknown as ElectronWindow
    if (!electronWin.electron?.loadStandardModel) {
      throw new Error('容器模型解析需要 Electron 环境（Rust Native 模块）')
    }

    logger.debug('PeroContainer', '准备解析模型', { dataSize: modelData.length })

    const parsedData = await electronWin.electron.loadStandardModel(
      modelData,
      this.boneFilterPatterns,
    )

    if (!parsedData?.bones?.length) {
      logger.warn('PeroContainer', '解析出的模型骨骼为空')
    } else {
      logger.debug('PeroContainer', '模型解析成功', { boneCount: parsedData.bones.length })
    }

    return parsedData
  }

  async getTexture(): Promise<THREE.Texture> {
    await this.ensureLoaded()

    // 查找纹理文件
    const textureData = this.findFile([
      'textures/texture.png',
      'texture.png',
      '.png',
      '.jpg',
      '.jpeg',
    ])
    if (!textureData) {
      throw new Error('[PeroContainer] 容器内未找到纹理文件')
    }

    const cacheKey = this.containerUrl + '_texture'
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!
    }

    return new Promise((resolve, reject) => {
      // 从内存数据创建 Blob URL
      const blob = new Blob([new Uint8Array(textureData)], { type: 'image/png' })
      const url = URL.createObjectURL(blob)

      new THREE.TextureLoader().load(
        url,
        (texture) => {
          texture.magFilter = THREE.NearestFilter
          texture.minFilter = THREE.NearestFilter
          texture.generateMipmaps = false // 像素风禁用 Mipmaps
          texture.colorSpace = THREE.SRGBColorSpace
          this.textureCache.set(cacheKey, texture)
          URL.revokeObjectURL(url)
          resolve(texture)
        },
        undefined,
        (error) => {
          logger.error('PeroContainer', '加载纹理失败', error)
          URL.revokeObjectURL(url)
          reject(error)
        },
      )
    })
  }

  async getAnimations(): Promise<Map<string, unknown>> {
    await this.ensureLoaded()

    const animations = new Map<string, unknown>()
    const animFiles = this.findAllFiles(['.animation.json'])

    for (const [path, data] of animFiles) {
      try {
        const text = new TextDecoder().decode(data)
        const json = JSON.parse(text)
        if (json.animations) {
          for (const [key, value] of Object.entries(json.animations)) {
            animations.set(key, value)
          }
        }
      } catch (e) {
        logger.warn('PeroContainer', `解析动画失败: ${path}`, e)
      }
    }

    return animations
  }

  /** 获取动画控制器 */
  async getAnimationControllers(): Promise<Map<string, unknown>> {
    await this.ensureLoaded()

    const controllers = new Map<string, unknown>()
    const controllerFiles = this.findAllFiles(['.controller.json', 'controller.json'])

    for (const [path, data] of controllerFiles) {
      try {
        const text = new TextDecoder().decode(data)
        const json = JSON.parse(text)
        if (json.animation_controllers) {
          for (const [key, value] of Object.entries(json.animation_controllers)) {
            controllers.set(key, value)
          }
        }
      } catch (e) {
        logger.warn('PeroContainer', `解析动画控制器失败: ${path}`, e)
      }
    }

    return controllers
  }

  // ══════ 扩展 API ══════

  /** 获取渲染控制器 */
  async getRenderControllers(): Promise<Map<string, unknown>> {
    await this.ensureLoaded()

    const controllers = new Map<string, unknown>()
    const controllerFiles = this.findAllFiles(['render_controllers.json'])

    for (const [path, data] of controllerFiles) {
      try {
        const text = new TextDecoder().decode(data)
        const json = JSON.parse(text)
        if (json.render_controllers) {
          for (const [key, value] of Object.entries(json.render_controllers)) {
            controllers.set(key, value)
          }
        }
      } catch (e) {
        logger.warn('PeroContainer', `解析渲染控制器失败: ${path}`, e)
      }
    }

    return controllers
  }

  /** 获取容器内的所有文件路径 */
  async getFileList(): Promise<string[]> {
    await this.ensureLoaded()
    return Array.from(this.files.keys())
  }

  /** 获取指定路径的文件数据 */
  async getFile(path: string): Promise<Uint8Array | undefined> {
    await this.ensureLoaded()
    return this.files.get(path.toLowerCase())
  }

  // ══════ 内部方法 ══════

  /** 加载并解密容器（仅执行一次） */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    const electronWin = window as unknown as ElectronWindow
    if (!electronWin.electron?.loadPeroContainer) {
      throw new Error('容器解密需要 Electron 环境（Rust Native 模块）')
    }

    // 获取加密的容器数据
    const url = this.containerUrl
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`加载容器失败: ${this.containerUrl}`)
    }
    const arrayBuffer = await response.arrayBuffer()

    // 调用 Rust Native 解密并解包
    const container = await electronWin.electron.loadPeroContainer(new Uint8Array(arrayBuffer))

    // 构建文件映射（路径统一为小写、正斜杠）
    for (const file of container.files) {
      const normalizedPath = file.path.toLowerCase().replace(/\\/g, '/')
      this.files.set(normalizedPath, file.data)
    }

    this.loaded = true
  }

  /** 根据模式列表查找第一个匹配的文件 */
  private findFile(patterns: string[]): Uint8Array | undefined {
    for (const pattern of patterns) {
      const normalizedPattern = pattern.toLowerCase()
      // 精确匹配
      if (this.files.has(normalizedPattern)) {
        return this.files.get(normalizedPattern)
      }
      // 后缀匹配
      for (const [path, data] of this.files) {
        if (path.endsWith(normalizedPattern)) {
          return data
        }
      }
    }
    return undefined
  }

  /** 查找所有匹配模式的文件 */
  private findAllFiles(patterns: string[]): Map<string, Uint8Array> {
    const result = new Map<string, Uint8Array>()
    for (const pattern of patterns) {
      const normalizedPattern = pattern.toLowerCase()
      for (const [path, data] of this.files) {
        if (path.endsWith(normalizedPattern)) {
          result.set(path, data)
        }
      }
    }
    return result
  }
}

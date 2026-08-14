/**
 * Manifest 加载器
 *
 * 从不同来源（JSON 文件 / .pero 容器）加载模型配置清单，
 * 并对 Manifest 结构进行完整性校验。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/ManifestLoader
 */

import { logger } from '../../../../lib/logger'
import type { IAvatarManifest } from './IAvatarManifest'
import { resolveAvatarAssetUrl, resolveAvatarManifestUrls } from '../avatarAssetUrl'

/**
 * Manifest 加载器
 *
 * 提供静态方法从各种来源加载和验证 IAvatarManifest。
 */
export class ManifestLoader {
  /**
   * 从 JSON 文件加载 Manifest
   *
   * @param path - JSON 文件路径（相对或绝对）
   * @returns 验证通过的 Manifest 对象
   * @throws {Error} 网络请求失败或数据校验不通过时抛出
   */
  static async fromJson(path: string): Promise<IAvatarManifest> {
    const response = await fetch(resolveAvatarAssetUrl(path))
    if (!response.ok) {
      throw new Error(`加载 Manifest 失败: ${path}`)
    }
    const manifest = await response.json()
    return resolveAvatarManifestUrls(ManifestLoader.validate(manifest))
  }

  /**
   * 从 .pero 文件加载 Manifest
   *
   * .pero 文件的元数据段包含 Manifest 信息，需要通过解密器提取。
   *
   * @param path - .pero 文件路径
   * @param decryptor - 解密函数（将原始二进制转为 Manifest 对象）
   * @returns 解密后的 Manifest 对象
   * @throws {Error} 未提供解密器时抛出
   */
  static async fromPero(
    path: string,
    decryptor?: (data: ArrayBuffer) => Promise<IAvatarManifest>,
  ): Promise<IAvatarManifest> {
    if (decryptor) {
      const url = path
      const response = await fetch(url)
      const data = await response.arrayBuffer()
      return decryptor(data)
    }

    throw new Error('加载 .pero Manifest 需要提供解密器')
  }

  /**
   * 验证 Manifest 结构完整性
   *
   * 检查必需字段（metadata、resources）并为可选字段提供默认值。
   *
   * @param manifest - 待验证的原始对象
   * @returns 验证通过的 Manifest 对象
   * @throws {Error} 缺少必要字段时抛出
   */
  static validate(manifest: Record<string, unknown>): IAvatarManifest {
    const m = manifest as Record<string, Record<string, unknown>>

    if (!m.metadata) {
      throw new Error('Manifest 缺少 metadata 字段')
    }
    if (!m.metadata.name) {
      throw new Error('Manifest metadata 缺少 name 字段')
    }
    if (!m.resources) {
      throw new Error('Manifest 缺少 resources 字段')
    }
    if (!m.resources.model) {
      throw new Error('Manifest resources 缺少 model 字段')
    }
    if (!m.resources.texture) {
      throw new Error('Manifest resources 缺少 texture 字段')
    }
    if (!manifest.retargetingMap) {
      logger.warn('ManifestLoader', 'Manifest 缺少 retargetingMap，使用空映射')
      manifest.retargetingMap = { mapping: {} }
    }
    if (!manifest.featureButtons) {
      logger.warn('ManifestLoader', 'Manifest 缺少 featureButtons，使用空数组')
      manifest.featureButtons = []
    }

    return manifest as unknown as IAvatarManifest
  }

  /**
   * 从适配器获取的 Manifest 片段构建完整 Manifest
   *
   * 用于兼容旧的适配器模式 — 将适配器的部分配置与外部资源路径合并。
   *
   * @param adapterManifest - 适配器提供的 Manifest 片段
   * @param resources - 资源路径配置
   * @returns 完整的 Manifest 对象
   */
  static buildFromAdapter(
    adapterManifest: Partial<IAvatarManifest>,
    resources: {
      model: string
      texture: string
      animations?: string[]
      animation_controllers?: string | string[]
    },
  ): IAvatarManifest {
    return {
      metadata: adapterManifest.metadata || {
        name: 'Unknown',
        version: '1.0.0',
      },
      featureButtons: adapterManifest.featureButtons || [],
      parts: adapterManifest.parts || [],
      retargetingMap: adapterManifest.retargetingMap || { mapping: {} },
      resources: {
        model: resources.model,
        texture: resources.texture,
        animations: resources.animations,
      },
      animation_controllers: resources.animation_controllers,
    }
  }
}

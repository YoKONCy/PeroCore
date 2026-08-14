/**
 * 看板娘资源 URL 适配
 *
 * Vite 开发服务器和 Web 部署可直接使用 `/assets/...`；Electron 打包版通过
 * `file://.../index.html` 加载页面，根路径会错误指向磁盘根目录，因此需要改为
 * 相对 renderer 目录的 `./assets/...`。
 */

import type { IAvatarManifest } from './adapter/IAvatarManifest'

/** 将模型资源 URL 转换为当前运行环境可 fetch 的路径。 */
export function resolveAvatarAssetUrl(url: string): string {
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'file:' &&
    url.startsWith('/assets/')
  ) {
    return `.${url}`
  }
  return url
}

/** 统一转换 manifest 内的全部外部资源路径。 */
export function resolveAvatarManifestUrls(manifest: IAvatarManifest): IAvatarManifest {
  const controllers = manifest.animation_controllers
  return {
    ...manifest,
    resources: {
      ...manifest.resources,
      model: resolveAvatarAssetUrl(manifest.resources.model),
      texture: resolveAvatarAssetUrl(manifest.resources.texture),
      animations: manifest.resources.animations?.map(resolveAvatarAssetUrl),
    },
    animation_controllers: Array.isArray(controllers)
      ? controllers.map(resolveAvatarAssetUrl)
      : controllers
        ? resolveAvatarAssetUrl(controllers)
        : undefined,
    ysmFunctions: manifest.ysmFunctions?.map(resolveAvatarAssetUrl),
  }
}

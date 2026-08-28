/**
 * YSM 模型清单前端加载器
 *
 * 纯浏览器/Web 场景兜底：当模型目录只有 ysm.json 而没有落盘的 manifest.json 时，
 * 运行时读取 ysm.json + models/main.json 并调用共享生成器生成标准模型清单。
 * Electron 场景通常已由主进程在扫描时落盘生成 manifest.json，无需走此路径。
 *
 * @module packages/frontend/src/components/avatar/lib/ysm/loadYsmManifest
 */

import { YsmManifestGenerator, type YsmGeneratedManifest } from '@infos/avatar-assets'
import { resolveAvatarAssetUrl, resolveAvatarManifestUrls } from '../avatarAssetUrl'

/** 从模型 Bedrock JSON 提取骨骼名与可见包围盒高度 */
async function extractModelMeta(
  modelUrl: string,
): Promise<{ bones: string[]; visibleHeight?: number }> {
  try {
    const res = await fetch(modelUrl)
    if (!res.ok) return { bones: [] }
    const raw = (await res.json()) as {
      'minecraft:geometry'?: Array<{
        bones?: Array<{ name?: string }>
        description?: { visible_bounds_height?: number }
      }>
    }
    const geo = raw['minecraft:geometry']?.[0]
    const bones = (geo?.bones ?? []).map((b) => b.name).filter((name): name is string => !!name)
    return { bones, visibleHeight: geo?.description?.visible_bounds_height }
  } catch {
    return { bones: [] }
  }
}

/**
 * 从 ysm.json URL 运行时生成标准模型清单
 *
 * @param ysmUrl - ysm.json 的绝对/相对 URL（形如 /assets/3d/<name>/ysm.json）
 */
export async function loadYsmManifestFromUrl(ysmUrl: string): Promise<YsmGeneratedManifest> {
  const resolvedYsmUrl = resolveAvatarAssetUrl(ysmUrl)
  const res = await fetch(resolvedYsmUrl)
  if (!res.ok) throw new Error(`加载 ysm.json 失败: ${ysmUrl}`)
  const ysm = (await res.json()) as Parameters<typeof YsmManifestGenerator.fromYsm>[0]

  // 从原始 URL 推导模型目录与名称，确保生成器仍输出标准 /assets 路径。
  const dirUrl = ysmUrl.slice(0, ysmUrl.lastIndexOf('/'))
  const dirName = decodeURIComponent(dirUrl.split('/').pop() || '')

  // 提取骨骼名与尺度信息；读取时使用当前运行环境可 fetch 的 URL。
  const { bones, visibleHeight } = await extractModelMeta(
    resolveAvatarAssetUrl(`${dirUrl}/models/main.json`),
  )

  return resolveAvatarManifestUrls(
    YsmManifestGenerator.fromYsm(ysm, dirName, bones, visibleHeight),
  ) as YsmGeneratedManifest
}

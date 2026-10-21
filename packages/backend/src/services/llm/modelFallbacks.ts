/** 回退顺序独立存入配置库，引用已有模型卡片，不复制密钥。 */
export const modelFallbackKey = (id: number) => `model.fallbacks.${id}`

export function modelFallbackIds(raw: string | undefined, rootId: number): number[] {
  if (!raw) return []
  try {
    const ids: unknown = JSON.parse(raw)
    if (!Array.isArray(ids)) return []
    return [
      ...new Set(
        ids.filter(
          (id): id is number =>
            typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && id !== rootId,
        ),
      ),
    ].slice(0, 32)
  } catch {
    return []
  }
}

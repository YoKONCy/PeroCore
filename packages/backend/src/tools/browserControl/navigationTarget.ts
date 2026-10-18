import type { ToolContext } from '../../services/agent/toolRegistry'

export type BrowserPreviewResolver = (source: string, context: ToolContext) => Promise<string>

/** 文件引用先通过工作区权限与短期预览票据，绝不拼成远程网址或交给系统启动器。 */
export async function browserNavigationTarget(
  input: string,
  context: ToolContext,
  preview?: BrowserPreviewResolver,
): Promise<string> {
  context.signal?.throwIfAborted()
  const value = input.trim().replace(/^resource:/i, '')
  if (!value) throw new Error('BROWSER_TARGET_REQUIRED: 请提供网址或工作区 HTML 路径')
  if (/^https?:\/\//i.test(value) || value === 'about:blank') {
    new URL(value)
    return value
  }
  const hostLike =
    /^(?:localhost|[\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]|$)/i.test(value) &&
    !/\.html?(?:[?#]|$)/i.test(value.split(/[\\/]/)[0]!)
  const local =
    /^(?:resource:)?(?:workspace:|attachment:|file:)/i.test(value) ||
    /^[a-z]:[\\/]/i.test(value) ||
    /^[.\\/]/.test(value) ||
    (!hostLike && /\.html?(?:[?#]|$)/i.test(value))
  if (local) {
    if (!preview) throw new Error('BROWSER_PREVIEW_UNAVAILABLE: 工作区网页预览尚未就绪，请稍后重试')
    const target = await preview(value, context)
    context.signal?.throwIfAborted()
    if (!/^https?:\/\//i.test(target))
      throw new Error('BROWSER_PREVIEW_INVALID: 预览服务未返回有效网址')
    return target
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !hostLike)
    throw new Error('BROWSER_URL_SCHEME_BLOCKED: 仅支持 HTTP/HTTPS 网站或受权的工作区 HTML 预览')
  const target = new URL(`https://${value}`)
  if (!target.hostname) throw new Error('BROWSER_TARGET_INVALID: 网址无效')
  return `https://${value}`
}

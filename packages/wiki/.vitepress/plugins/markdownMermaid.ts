/**
 * Markdown-it Mermaid 流程图代码块拦截与组件化渲染插件
 *
 * 拦截 ```mermaid 代码块，转换为自定义全局 Vue 组件 <Mermaid code="..." />
 * 结合客户端 mermaid.js 实现高颜值矢量 SVG 流程图自动绘制。
 *
 * @module packages/wiki/.vitepress/plugins/markdownMermaid
 */

import type MarkdownIt from 'markdown-it'

/**
 * 注册 Mermaid 代码块解析拦截插件
 *
 * @param md Markdown-it 实例
 */
export function markdownMermaid(md: MarkdownIt): void {
  const defaultFence = md.renderer.rules.fence!

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const info = token.info ? token.info.trim() : ''

    if (info === 'mermaid') {
      const code = token.content.trim()
      // 对代码内容进行 URI 编码，避免在 Vue template 属性解析时出现特殊字符转义错乱
      const encoded = encodeURIComponent(code)
      return `<Mermaid code="${encoded}" />\n`
    }

    return defaultFence(tokens, idx, options, env, self)
  }
}

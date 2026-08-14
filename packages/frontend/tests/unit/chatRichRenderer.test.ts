// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderChatRichText } from '../../src/lib/chatRichRenderer'

describe('chatRichRenderer', () => {
  it('应当保持块公式、标题和代码块为互不污染的同级结构', () => {
    const html = renderChatRichText(`$$
E = mc^2
$$

## 数学公式

正文包含 $a+b$。

\`\`\`python
print("你好")
\`\`\``)

    const root = document.createElement('div')
    root.innerHTML = html
    expect(root.querySelector('.chat-math-block')).not.toBeNull()
    expect(root.querySelector('h2')?.textContent).toBe('数学公式')
    expect(root.querySelector('.chat-code-block code')?.textContent).toContain('print("你好")')
    expect(root.querySelector('p .chat-math-block')).toBeNull()
    expect(root.textContent).not.toContain('%E')
  })

  it('应当只保留无内容的复制标记，不把源码编码写进可见 DOM', () => {
    const html = renderChatRichText('```json\n{"状态":"正常"}\n```')
    const root = document.createElement('div')
    root.innerHTML = html
    const button = root.querySelector<HTMLButtonElement>('[data-copy-code]')
    expect(button).not.toBeNull()
    expect(button?.getAttribute('data-copy-code')).toBe('')
    expect(root.textContent).not.toContain('%7B')
  })
})

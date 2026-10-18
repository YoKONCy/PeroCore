import { describe, expect, it } from 'vitest'
import {
  createApplicationWaitingContent,
  createApplicationWaitingPage,
} from '../src/applicationWaitingPage'

describe('子应用共用启动画面', () => {
  it('外壳直接嵌入 SVG，不创建框架和导航', () => {
    const content = createApplicationWaitingContent({ dark: true, applicationName: 'Arca' })
    expect(content).toContain('<svg ')
    expect(content).toContain('等一下，马上就好~')
    expect(content).not.toMatch(/<iframe|<script|<html|<body/i)
    expect(content).not.toMatch(/(?:^|\n)\s*(?:body|main|h1|\*)\s*\{/)
    expect(content).toContain('.infos-application-waiting h1')
  })

  it('原生管理页复用同一画面，并转义应用名称', () => {
    const options = {
      dark: false,
      applicationName: '</style><script>窗口</script>',
      motion: 'off' as const,
    }
    const content = createApplicationWaitingContent(options)
    const page = createApplicationWaitingPage(options)
    expect(page).toContain(content)
    expect(content).toContain('data-motion="off"')
    expect(content).toContain('&lt;script&gt;窗口&lt;/script&gt;')
    expect(page).not.toContain('<script>')
  })
})

/**
 * Arca UI/UX V4防回归测试。
 * 形态权威来自A11 §29.27.13“精密星页终端”。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = join(__dirname, '../src')
const stylesRoot = join(srcRoot, 'styles')
const workbench = readFileSync(join(stylesRoot, 'workbench.css'), 'utf-8')
const tokens = readFileSync(join(stylesRoot, 'tokens.css'), 'utf-8')
const home = readFileSync(join(srcRoot, 'views/HomeView.vue'), 'utf-8')
const app = readFileSync(join(srcRoot, 'App.vue'), 'utf-8')
const settingsService = readFileSync(join(srcRoot, 'services/settings.ts'), 'utf-8')
const settingsView = readFileSync(join(srcRoot, 'views/SettingsView.vue'), 'utf-8')

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listFiles(full) : [full]
  })
}

describe('Arca UI/UX V4设计约束', () => {
  it('普通形态令牌必须为0px，仅浮层允许4px', () => {
    for (const token of ['page', 'panel', 'btn', 'ctrl', 'text']) {
      expect(tokens).toContain(`--arca-radius-${token}: 0px`)
    }
    expect(tokens).toContain('--arca-radius-float: 4px')
  })

  it('启动台必须使用文件索引而不是Hero与卡片网格', () => {
    expect(home).toContain('class="index-terminal"')
    expect(home).toContain('class="file-index"')
    expect(home).not.toContain('launch-intro')
    expect(home).not.toContain('star-grid')
    expect(home).not.toContain('star-card')
  })

  it('工作站编辑面必须使用连续绢纸材质且禁止玻璃与悬浮纸卡', () => {
    const material = /\.file-index,\s*\.star-page-stage,\s*\.property-surface \{[\s\S]*?\n\}/.exec(
      workbench,
    )![0]!
    const page = /\.star-page \{[^}]+\}/.exec(workbench)![0]!
    expect(material).toContain('background-color: var(--arca-paper)')
    expect(material).toContain('var(--arca-paper-fiber)')
    expect(material).toContain('var(--arca-paper-cross-fiber)')
    expect(material).toContain('var(--arca-paper-knot)')
    expect(material).toContain("seed='43'")
    expect(material).not.toContain('backdrop-filter')
    expect(page).toContain('background: transparent')
    expect(page).not.toContain('border-radius')
    expect(page).not.toContain('box-shadow')
  })

  it('总托底与编辑面必须使用不同的多层程序材质', () => {
    expect(tokens).toContain('--arca-desk-pit:')
    expect(tokens).toContain('--arca-paper-fiber:')
    expect(tokens).toContain('--arca-paper-cross-fiber:')
    expect(tokens).toContain('--arca-paper-knot:')
    expect(workbench).toContain("seed='17'")
    expect(workbench).toContain("seed='71'")
    expect(workbench).toContain("seed='43'")
    expect(workbench).toContain("seed='89'")
    expect(workbench).toContain("baseFrequency='.012 .16'")
    expect(workbench).toContain("baseFrequency='.22 .025'")
    expect(workbench).toContain('background-blend-mode: soft-light')
    expect(workbench).toContain('radial-gradient(ellipse')
    expect(workbench).not.toContain('repeating-radial-gradient')
  })

  it('工作站必须使用稳定的连续工作面与固定检查器网格', () => {
    const body = /\.folio-body \{[^}]+\}/.exec(workbench)![0]!
    expect(body).toContain("grid-template-areas: 'rail navigator document inspector'")
    expect(body).toContain('var(--navigator-width) minmax(0, 1fr) 320px')
    expect(workbench).toContain('.folio-body.navigator-open')
    expect(workbench).toContain('grid-area: document')
    expect(workbench).toContain('grid-area: inspector')
  })

  it('设置必须使用贯穿属性分区而不是独立卡片', () => {
    const group = /\.property-group \{[^}]+\}/.exec(workbench)![0]!
    expect(group).toContain('margin: 0')
    expect(group).toContain('border: 0')
    expect(group).toContain('box-shadow: none')
    expect(group).not.toContain('border-radius')
  })

  it('结构面必须使用独立细粒磨砂材质', () => {
    const structure = /\.terminal-header,[\s\S]*?\.property-nav \{[\s\S]*?\n\}/.exec(workbench)![0]!
    expect(structure).toContain("seed='23'")
    expect(structure).toContain("baseFrequency='.48'")
    expect(structure).toContain('background-blend-mode: soft-light')
  })

  it('状态灯和工作节点必须保持方形', () => {
    const state = /\.status-light,\s*\.tiny-state \{[^}]+\}/.exec(workbench)![0]!
    expect(state).toContain('border-radius: 0')
    expect(workbench).toMatch(/\.file-state i \{[^}]*width: 6px[^}]*height: 6px/)
  })

  it('主操作必须使用切角与2px硬阴影', () => {
    const action = /\.primary-button,\s*\.pixel-action \{[^}]+\}/.exec(workbench)![0]!
    expect(action).toContain('box-shadow: 2px 2px 0')
    expect(action).toContain('clip-path: polygon')
    expect(workbench).toMatch(/translate\(2px, 2px\)/)
  })

  it('路由必须使用断线扫描过渡并提供减少动效降级', () => {
    expect(app).toContain('Transition name="surface-route"')
    expect(workbench).toContain('.route-scanline')
    expect(workbench).toContain('@keyframes route-scan')
    expect(workbench).toContain("[data-motion='reduced']")
    expect(workbench).toContain('prefers-reduced-motion')
  })

  it('1024px文件索引必须收敛为四列且禁止横向滚动', () => {
    expect(workbench).toContain('@media (max-width: 1100px)')
    expect(workbench).toMatch(/\.file-index\s*\{\s*overflow-x:\s*hidden/)
    expect(workbench).toContain('.file-index-head > :nth-child(5)')
    expect(workbench).toContain('.file-index-head > :nth-child(6)')
    expect(workbench).toContain('.file-index-row > :nth-child(5)')
    expect(workbench).toContain('.file-index-row > :nth-child(6)')
  })

  it('Arca模型设置必须使用本地Authority而不是Kernel模型仓库', () => {
    expect(settingsService).not.toContain('/api/models')
    expect(settingsService).not.toContain('KernelModelConfig')
    expect(settingsView).toContain("invokeModelAuthority('model.save'")
    expect(settingsView).toContain('Arca本地Secret Store')
    expect(settingsView).not.toContain('只发送给Kernel保存')
  })

  it('源码禁止系统原生确认框', () => {
    const offenders = listFiles(srcRoot)
      .filter((file) => file.endsWith('.vue') || file.endsWith('.ts'))
      .filter((file) => readFileSync(file, 'utf-8').includes('window.confirm'))
    expect(offenders).toEqual([])
  })
})

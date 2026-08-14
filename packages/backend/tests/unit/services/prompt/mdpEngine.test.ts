import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MdpEngine, type PromptSlot } from '@infos/backend/services/prompt/mdpEngine'

vi.mock('@infos/backend/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('MdpEngine', () => {
  let rootDir: string
  let promptDir: string
  let agentsDir: string

  beforeEach(() => {
    rootDir = join(tmpdir(), `infos-mdp-${Date.now()}-${Math.random()}`)
    promptDir = join(rootDir, 'prompts')
    agentsDir = join(rootDir, 'agents')
    mkdirSync(join(promptDir, 'slots'), { recursive: true })
    mkdirSync(join(agentsDir, 'pero', 'slots'), { recursive: true })
    writeFileSync(
      join(promptDir, 'system.md'),
      `---
role: system
position: 100
slotId: system_core
label: 系统核心
group: core
editable: false
builtin: true
---
你好 {{ name | d("主人") }}<!-- 删除我 -->`,
      'utf-8',
    )
    writeFileSync(
      join(promptDir, 'slots', 'tools.md'),
      `---
role: system
position: 300
enabled: true
label: 工具列表
---
工具：{{ tools | joinlines }}`,
      'utf-8',
    )
    writeFileSync(join(promptDir, 'plain.txt'), '纯文本 {{ value }}', 'utf-8')
    writeFileSync(join(agentsDir, 'pero', 'system.md'), 'Pero 专属 {{ name }}', 'utf-8')
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  describe('模板加载与渲染', () => {
    it('应当扫描 md 和 txt 模板并提供键列表与短名访问', () => {
      const engine = new MdpEngine(promptDir)

      const keys = engine.listKeys().sort()

      // AIOS: slots/tools.md 现在同时注册 'slots/tools' 全名和 'tools' 短名
      expect(keys).toEqual(['pero/system', 'plain', 'slots/tools', 'system', 'tools'].sort())
      expect(engine.getPrompt('system')).toMatchObject({
        key: 'system',
        meta: {
          role: 'system',
          position: 100,
          slotId: 'system_core',
          label: '系统核心',
          group: 'core',
          editable: false,
          builtin: true,
        },
      })
    })

    it('应当渲染普通模板并剥离 HTML 注释', () => {
      const engine = new MdpEngine(promptDir)

      const result = engine.render('system', { name: '主人' })

      expect(result).toBe('你好 主人')
    })

    it('存在 Agent 覆盖模板时应当优先使用覆盖内容', () => {
      const engine = new MdpEngine(promptDir)

      const result = engine.render('system', { agent_id: 'pero', name: 'Nana' })

      expect(result).toBe('Pero 专属 Nana')
    })

    it('模板缺失时应当返回 Missing 占位文本', () => {
      const engine = new MdpEngine(promptDir)

      const result = engine.render('missing/template')

      expect(result).toBe('{{Missing: missing/template}}')
    })

    it('renderString 应当支持自定义过滤器', () => {
      const engine = new MdpEngine(promptDir)

      const result = engine.renderString(
        '{{ text | truncate(4) }} {{ empty | d("默认") }} {{ time | timeago }} {{ lines | joinlines }} {{ xml | xmlwrap("tag") }}',
        {
          text: 'abcdef',
          empty: null,
          time: new Date().toISOString(),
          lines: ['a', '', 'b'],
          xml: '内容',
        },
      )

      expect(result).toContain('abcd... 默认 刚刚 a\nb <tag>\n内容\n</tag>')
    })
  })

  describe('槽位与预设', () => {
    it('buildDefaultSlots 应当从带 role 元数据的模板构建并按 position 排序', () => {
      const engine = new MdpEngine(promptDir)

      const slots = engine.buildDefaultSlots()

      expect(slots.map((slot) => slot.id)).toEqual(['system_core', 'slots/tools'])
      expect(slots[0]).toMatchObject({
        label: '系统核心',
        role: 'system',
        position: 100,
        enabled: true,
        group: 'core',
        editable: false,
        builtin: true,
      })
    })

    it('renderSlots 应当跳过禁用与空内容，并默认合并相邻同角色消息', () => {
      const engine = new MdpEngine(promptDir)
      const slots: PromptSlot[] = [
        {
          id: 'a',
          label: 'A',
          role: 'system',
          position: 1,
          enabled: true,
          template: '你好 {{ name }}',
          group: 'test',
          editable: true,
          builtin: false,
        },
        {
          id: 'b',
          label: 'B',
          role: 'system',
          position: 2,
          enabled: true,
          template: '  ',
          group: 'test',
          editable: true,
          builtin: false,
        },
        {
          id: 'c',
          label: 'C',
          role: 'system',
          position: 3,
          enabled: true,
          template: '工具 {{ tool }}',
          userOverride: '覆盖 {{ tool }}',
          group: 'test',
          editable: true,
          builtin: false,
        },
      ]

      const messages = engine.renderSlots(slots, { name: '主人', tool: '搜索' })

      expect(messages).toEqual([
        {
          role: 'system',
          content: '你好 主人\n\n覆盖 搜索',
          slotId: 'a+c',
        },
      ])
      expect(slots[0]?.rendered).toBe('你好 主人')
      expect(slots[2]?.rendered).toBe('覆盖 搜索')
    })

    it('renderSlots 关闭合并时应当保留原始消息边界', () => {
      const engine = new MdpEngine(promptDir)
      const slots = engine.buildDefaultSlots()

      const messages = engine.renderSlots(
        slots,
        { name: '主人', tools: ['search'] },
        { mergeAdjacentRoles: false },
      )

      expect(messages).toEqual([
        { role: 'system', content: '你好 主人', slotId: 'system_core' },
        { role: 'system', content: '工具：search', slotId: 'slots/tools' },
      ])
    })

    it('applyPreset 应当覆盖已有槽位并合并新增自定义槽位', () => {
      const engine = new MdpEngine(promptDir)
      const slots = engine.buildDefaultSlots()

      const result = engine.applyPreset(slots, {
        name: '自定义',
        slots: [
          { id: 'system_core', position: 500, enabled: false, userOverride: '覆盖人设' },
          {
            id: 'custom_tail',
            position: 50,
            enabled: true,
            label: '尾部',
            role: 'user',
            template: '追加内容',
          },
        ],
      })

      expect(result.map((slot) => slot.id)).toEqual(['custom_tail', 'slots/tools', 'system_core'])
      expect(result.find((slot) => slot.id === 'system_core')).toMatchObject({
        position: 500,
        enabled: false,
        userOverride: '覆盖人设',
      })
      expect(result.find((slot) => slot.id === 'custom_tail')).toMatchObject({
        role: 'user',
        group: 'custom',
        editable: true,
        builtin: false,
      })
    })

    it('exportPreset、savePreset 和 loadPreset 应当保持预设结构', () => {
      const engine = new MdpEngine(promptDir)
      const slots = engine.applyPreset(engine.buildDefaultSlots(), {
        name: '临时',
        slots: [{ id: 'system_core', position: 200, enabled: true, userOverride: '覆盖' }],
      })
      const presetPath = join(rootDir, 'presets', 'demo.json')

      const preset = engine.exportPreset('演示预设', slots, '说明')
      engine.savePreset(preset, presetPath)
      const loaded = engine.loadPreset(presetPath)

      expect(loaded).toEqual(preset)
    })

    it('loadPreset 读取失败时应当返回 null', () => {
      const engine = new MdpEngine(promptDir)

      const loaded = engine.loadPreset(join(rootDir, 'missing.json'))

      expect(loaded).toBeNull()
    })
  })
})

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilityGate } from '@perocore/backend/capabilities/capabilityGate'
import type { SkillManifest } from '@perocore/backend/capabilities/types'

vi.mock('@perocore/backend/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

type SkillLoaderMock = {
  getManifest: ReturnType<typeof vi.fn>
}

type ToolRegistryMock = {
  getDefinitions: ReturnType<typeof vi.fn>
}

function createManifest(id: string, requiredTools: string[] = []): SkillManifest {
  return {
    id,
    name: `${id} 技能`,
    description: `${id} 描述`,
    requiredTools,
    category: 'test',
    tags: [],
    parameters: {},
    dependsOnSkills: [],
  }
}

describe('CapabilityGate', () => {
  let rootDir: string
  let skillLoader: SkillLoaderMock
  let toolRegistry: ToolRegistryMock

  beforeEach(() => {
    rootDir = join(tmpdir(), `perocore-capability-${Date.now()}-${Math.random()}`)
    mkdirSync(join(rootDir, 'pero'), { recursive: true })
    writeFileSync(
      join(rootDir, 'pero', 'capabilities.yaml'),
      `agent: pero
modes:
  desktop:
    tools:
      - chat.send
      - memory.search
    skills:
      - diary
    prompt_fragments:
      - prompts/base.md
  browser:
    tools:
      - browser.open
    skills: []
    prompt_fragments:
      - prompts/browser.md
`,
      'utf-8',
    )
    skillLoader = {
      getManifest: vi.fn((skillId: string) =>
        skillId === 'diary' ? createManifest('diary', ['memory.write']) : undefined,
      ),
    }
    toolRegistry = {
      getDefinitions: vi.fn(() => [
        { name: 'chat.send', description: '发送聊天消息' },
        { name: 'memory.search', description: '搜索记忆' },
        { name: 'browser.open', description: '打开浏览器' },
        { name: 'memory.write', description: '写入记忆' },
        { name: 'blocked.tool', description: '不可用工具' },
      ]),
    }
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  describe('resolve', () => {
    it('应当按 Agent 和模式解析工具、技能、提示片段与描述文本', () => {
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      const resolved = gate.resolve('pero', 'desktop')

      expect([...resolved.allowedTools]).toEqual(['chat.send', 'memory.search'])
      expect(resolved.enabledSkills).toEqual([createManifest('diary', ['memory.write'])])
      expect(resolved.promptFragments).toEqual(['prompts/base.md'])
      expect(resolved.toolsDescription).toBe('- chat.send: 发送聊天消息\n- memory.search: 搜索记忆')
      expect(resolved.skillMenuText).toContain('- diary 技能: diary 描述')
    })

    it('第七阶段修复（批次 B3）：未配置的 channel 应当 fail-closed 返回空能力集', () => {
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      // mobile channel 未在 capabilities.yaml 中配置
      // 原实现会回退 desktop，导致意外继承桌面工具集 —— 安全漏洞
      // 现在改为 fail-closed，未配置 = 最小权限
      const resolved = gate.resolve('pero', 'mobile')

      expect([...resolved.allowedTools]).toEqual([])
      expect(resolved.enabledSkills).toEqual([])
      expect(resolved.promptFragments).toEqual([])
    })

    it('Agent 没有配置时应当返回空能力', () => {
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      const resolved = gate.resolve('unknown', 'desktop')

      expect([...resolved.allowedTools]).toEqual([])
      expect(resolved.enabledSkills).toEqual([])
      expect(resolved.promptFragments).toEqual([])
      expect(resolved.toolsDescription).toBe('')
      expect(resolved.skillMenuText).toBe('')
    })
  })

  describe('isToolAllowed', () => {
    it('应当始终允许 finish_task 和 load_skill', () => {
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      const finishAllowed = gate.isToolAllowed('unknown', 'desktop', 'finish_task')
      const loadAllowed = gate.isToolAllowed('unknown', 'desktop', 'load_skill')

      expect(finishAllowed).toBe(true)
      expect(loadAllowed).toBe(true)
    })

    it('应当基于模式白名单判断普通工具权限', () => {
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      const allowed = gate.isToolAllowed('pero', 'browser', 'browser.open')
      const denied = gate.isToolAllowed('pero', 'browser', 'memory.search')

      expect(allowed).toBe(true)
      expect(denied).toBe(false)
    })
  })

  describe('unlockSkillTools', () => {
    it('应当把 Skill 依赖工具临时加入指定会话白名单，并在清理会话后移除', () => {
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      gate.unlockSkillTools('session-1', 'diary')
      const allowedAfterUnlock = gate.isToolAllowed('pero', 'desktop', 'memory.write', 'session-1')
      gate.clearSession('session-1')
      const allowedAfterClear = gate.isToolAllowed('pero', 'desktop', 'memory.write', 'session-1')

      expect(allowedAfterUnlock).toBe(true)
      expect(allowedAfterClear).toBe(false)
    })

    it('Skill 不存在或没有依赖工具时不应创建额外权限', () => {
      skillLoader.getManifest.mockReturnValueOnce(undefined)
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      gate.unlockSkillTools('session-2', 'missing')
      const allowed = gate.isToolAllowed('pero', 'desktop', 'memory.write', 'session-2')

      expect(allowed).toBe(false)
    })
  })

  describe('配置查询', () => {
    it('应当返回 Agent 配置存在性、模式清单和去重后的技能清单', () => {
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      const hasPero = gate.hasConfig('pero')
      const hasUnknown = gate.hasConfig('unknown')
      const modes = gate.getAgentModes('pero')
      const skills = gate.getAgentSkills('pero')

      expect(hasPero).toBe(true)
      expect(hasUnknown).toBe(false)
      expect(modes).toEqual({
        desktop: {
          tools: ['chat.send', 'memory.search'],
          skills: ['diary'],
        },
        browser: {
          tools: ['browser.open'],
          skills: [],
        },
      })
      expect(skills).toEqual([{ id: 'diary', name: 'diary 技能', description: 'diary 描述' }])
    })

    it('未知 Agent 查询模式和技能时应当返回空结果', () => {
      const gate = new CapabilityGate([rootDir], skillLoader as never, toolRegistry as never)

      const modes = gate.getAgentModes('unknown')
      const skills = gate.getAgentSkills('unknown')

      expect(modes).toEqual({})
      expect(skills).toEqual([])
    })
  })
})

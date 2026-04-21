/**
 * load_skill — 技能加载工具
 *
 * 始终允许调用的生命周期工具 (CapabilityGate 白名单豁免)。
 * Agent 通过此工具按需加载 Skill 的详细指令到上下文。
 *
 * 加载时：
 * 1. 读取 SKILL.md 内容返回给 LLM
 * 2. 通过 CapabilityGate.unlockSkillTools() 临时解锁该 Skill 依赖的工具
 *
 * @module packages/backend/src/tools/loadSkill
 */

import type { BuiltinTool } from '../index'

export const loadSkillTool: BuiltinTool = {
  definition: {
    name: 'load_skill',
    description:
      '加载指定技能的详细操作指令。当你需要执行某个专业任务时，先调用此工具获取步骤说明。',
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: '要加载的技能 ID (从技能菜单中选择)',
        },
      },
      required: ['skill_id'],
    },
  },

  async execute(args) {
    const skillId = args.skill_id as string

    if (!skillId) {
      return JSON.stringify({ error: '缺少 skill_id 参数' })
    }

    // 实际的 Skill 加载逻辑由 ToolExecutor 层注入
    // 这里提供 fallback 响应
    // ToolExecutor 会拦截此工具调用并：
    //   1. 调用 SkillLoader.load(skillId) 获取 SKILL.md 内容
    //   2. 调用 CapabilityGate.unlockSkillTools(sessionId, skillId)
    //   3. 将 SKILL.md 内容作为结果返回

    return JSON.stringify({
      skill_id: skillId,
      status: 'loaded',
      message: `技能 ${skillId} 的详细指令已加载，请按步骤执行。`,
    })
  },
}

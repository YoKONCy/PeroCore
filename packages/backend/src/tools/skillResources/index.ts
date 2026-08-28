import type { BuiltinTool } from '../index'
import type { SkillLoader } from '../../capabilities/skillLoader'

let loader: SkillLoader | null = null

export function setSkillResourceLoader(value: SkillLoader): void {
  loader = value
}

export const skillListResourcesTool: BuiltinTool = {
  name: 'skill_list_resources',
  async execute(args) {
    if (!loader) return JSON.stringify({ error: 'Skill系统未初始化' })
    const skillId = String(args.skill_id ?? '')
    const manifest = loader.getManifest(skillId)
    if (!manifest) return JSON.stringify({ error: `Skill "${skillId}"不存在` })
    return JSON.stringify({ skill_id: skillId, resources: loader.listResources(skillId) })
  },
}

export const skillReadResourceTool: BuiltinTool = {
  name: 'skill_read_resource',
  async execute(args) {
    if (!loader) return JSON.stringify({ error: 'Skill系统未初始化' })
    const skillId = String(args.skill_id ?? '')
    const resourcePath = String(args.path ?? '')
    const content = loader.readResource(skillId, resourcePath)
    if (content === null) {
      return JSON.stringify({ error: '资源不存在、超出Skill目录或超过256KB限制' })
    }
    return JSON.stringify({ skill_id: skillId, path: resourcePath, content })
  },
}

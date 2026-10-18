interface SortableTool {
  name: string
  packageId?: string
  enabled: boolean
  locked?: boolean
}

/** 以函数名做确定性字母排序，不受用户语言或注册先后影响。 */
function compareName(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0
}

/** 系统启用项、普通启用项、关闭项依次排列；区内同包相邻，包与成员按函数名排序。 */
export function sortThreadTools<T extends SortableTool>(tools: readonly T[]): T[] {
  const blocks = new Map<string, { priority: number; key: string; tools: T[] }>()
  for (const tool of tools) {
    const priority = tool.enabled ? (tool.locked ? 0 : 1) : 2
    const key = tool.packageId ? `package:${tool.packageId}` : `tool:${tool.name}`
    const blockKey = `${priority}:${key}`
    let block = blocks.get(blockKey)
    if (!block) {
      block = { priority, key, tools: [] }
      blocks.set(blockKey, block)
    }
    block.tools.push(tool)
  }
  const groups = [...blocks.values()]
  for (const group of groups) group.tools.sort((a, b) => compareName(a.name, b.name))
  groups.sort(
    (a, b) =>
      a.priority - b.priority ||
      compareName(a.tools[0]!.name, b.tools[0]!.name) ||
      compareName(a.key, b.key),
  )
  return groups.flatMap((group) => group.tools)
}

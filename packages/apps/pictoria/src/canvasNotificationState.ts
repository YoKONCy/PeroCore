import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** 仅返回画布主动移除的任务标识，历史执行记录和资源保持完整。 */
export function dismissedCanvasRuns(db: Database.Database, owner: string): string[] {
  const hidden = new Set<string>(),
    projects = new Set<string>()
  const rows = db
    .prepare(
      "SELECT id,kind,value_json FROM entities WHERE owner=? AND kind IN ('project','dismissed-canvas')",
    )
    .all(owner) as Array<{ id: string; kind: string; value_json: string }>
  for (const row of rows.filter((row) => row.kind === 'project')) {
    projects.add(row.id)
    const value = JSON.parse(row.value_json) as { dismissedRunIds?: unknown }
    if (Array.isArray(value.dismissedRunIds))
      for (const id of value.dismissedRunIds) if (typeof id === 'string') hidden.add(id)
  }
  for (const row of rows.filter(
    (row) => row.kind === 'dismissed-canvas' && !projects.has(row.id),
  )) {
    const value = JSON.parse(row.value_json) as { runIds?: unknown }
    if (Array.isArray(value.runIds))
      for (const id of value.runIds) if (typeof id === 'string') hidden.add(id)
  }
  return [...hidden]
}

/** 宿主兼容层的离线只读入口；不创建数据库、不迁移、不读取凭据。 */
export function readDismissedCanvasRuns(root: string, owner: string): string[] {
  const filename = path.join(root, 'pictoria.sqlite')
  if (!existsSync(filename)) return []
  const db = new Database(filename, { readonly: true, fileMustExist: true })
  try {
    return dismissedCanvasRuns(db, owner)
  } finally {
    db.close()
  }
}

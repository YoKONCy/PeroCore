import { z } from 'zod'
import { identifier } from './domain'
import type { Store } from './store'

interface CanvasDocument {
  id: string
  revision: number
  collectionId?: string | null
  [key: string]: unknown
}
export function requireCollection(store: Store, owner: string, id: string | null | undefined) {
  if (id && !store.get(owner, 'collection', id)) throw new Error('项目不存在或不属于当前角色')
}
export function saveCollection(store: Store, owner: string, raw: unknown) {
  const input = z
    .object({
      definition: z.object({ id: identifier, title: z.string().trim().min(1).max(120) }).strict(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict()
    .parse(raw)
  return store.put(owner, 'collection', input.definition, input.expectedRevision)
}
export function moveCanvas(store: Store, owner: string, raw: unknown) {
  const input = z
    .object({
      id: identifier,
      collectionId: identifier.nullable(),
      expectedRevision: z.number().int().positive(),
    })
    .strict()
    .parse(raw)
  return store.transaction(() => {
    requireCollection(store, owner, input.collectionId)
    const canvas = store.get<CanvasDocument>(owner, 'project', input.id)
    if (!canvas) throw new Error('画布不存在或不属于当前角色')
    return store.put(
      owner,
      'project',
      { ...canvas, collectionId: input.collectionId },
      input.expectedRevision,
    )
  })
}
export function renameCanvas(store: Store, owner: string, raw: unknown) {
  const input = z
    .object({
      id: identifier,
      title: z.string().trim().min(1).max(120),
      expectedRevision: z.number().int().positive(),
    })
    .strict()
    .parse(raw)
  return store.transaction(() => {
    const canvas = store.get<CanvasDocument>(owner, 'project', input.id)
    if (!canvas) throw new Error('画布不存在或不属于当前角色')
    return store.put(owner, 'project', { ...canvas, title: input.title }, input.expectedRevision)
  })
}
export function deleteCollection(store: Store, owner: string, raw: unknown) {
  const input = z
    .object({ id: identifier, expectedRevision: z.number().int().positive() })
    .strict()
    .parse(raw)
  return store.transaction(() => {
    store.remove(owner, 'collection', input.id, input.expectedRevision)
    // 移除分组只解除归属，保留画布、素材与任务。
    const rows = store.db
      .prepare(
        "SELECT value_json FROM entities WHERE owner=? AND kind='project' AND json_extract(value_json,'$.collectionId')=?",
      )
      .all(owner, input.id) as Array<{ value_json: string }>
    const canvases = rows.map((row) => {
      const canvas = JSON.parse(row.value_json) as CanvasDocument
      const saved = store.put(owner, 'project', { ...canvas, collectionId: null }, canvas.revision)
      return { id: saved.id, previousRevision: canvas.revision, revision: saved.revision }
    })
    return { deleted: true, canvases }
  })
}

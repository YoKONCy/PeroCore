import { z } from 'zod'
import type { Store } from './store'
import type { Asset, Run } from './domain'
import { identifier } from './domain'
import { resolve } from './workflows'

export interface AssetMeta {
  id: string
  revision: number
  title?: string
  origin?: 'output'
  favorite?: boolean
  final?: boolean
  tags?: string[]
  runId?: string
  stepId?: string
  model?: string
  inputs?: Record<string, unknown>
  createdAt?: string
}
export function searchPrompts(store: Store, owner: string, raw: unknown) {
  const input = z
    .object({
      query: z.string().max(200).default(''),
      limit: z.number().int().min(1).max(100).default(30),
      offset: z.number().int().nonnegative().default(0),
    })
    .strict()
    .parse(raw)
  const where =
    "owner=? AND kind='prompt' AND (json_extract(value_json,'$.title') LIKE ? OR json_extract(value_json,'$.text') LIKE ? OR json_extract(value_json,'$.tags') LIKE ?)"
  const query = `%${input.query}%`,
    params = [owner, query, query, query]
  const { total } = store.db
    .prepare(`SELECT COUNT(*) AS total FROM entities WHERE ${where}`)
    .get(...params) as { total: number }
  const rows = store.db
    .prepare(
      `SELECT value_json FROM entities WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset) as Array<{ value_json: string }>
  return { total, items: rows.map((row) => JSON.parse(row.value_json)) }
}
export function libraryList(store: Store, owner: string, raw: unknown) {
  const input = z
    .object({
      kind: z.enum(['materials', 'artworks']).default('materials'),
      query: z.string().max(200).default(''),
      type: z.enum(['all', 'image', 'video', 'audio']).default('all'),
      favorites: z.boolean().default(false),
      final: z.boolean().default(false),
      limit: z.number().int().min(1).max(60).default(30),
      offset: z.number().int().nonnegative().default(0),
    })
    .strict()
    .parse(raw)
  indexExistingArtworks(store, owner)
  const filters = ['a.owner=?'],
    params: (string | number)[] = [owner]
  filters.push(
    input.kind === 'artworks'
      ? "json_extract(m.value_json,'$.origin')='output'"
      : "COALESCE(json_extract(m.value_json,'$.origin'),'')!='output'",
  )
  if (input.type !== 'all') {
    filters.push("json_extract(a.value_json,'$.mimeType') LIKE ?")
    params.push(`${input.type}/%`)
  }
  if (input.query) {
    filters.push(
      "(COALESCE(json_extract(m.value_json,'$.title'),json_extract(a.value_json,'$.name')) LIKE ? OR COALESCE(json_extract(m.value_json,'$.tags'),'') LIKE ?)",
    )
    params.push(`%${input.query}%`, `%${input.query}%`)
  }
  if (input.favorites) filters.push("json_extract(m.value_json,'$.favorite')=1")
  if (input.final) filters.push("json_extract(m.value_json,'$.final')=1")
  const from = `FROM assets a LEFT JOIN entities m ON m.owner=a.owner AND m.kind='asset-meta' AND m.id=a.id WHERE ${filters.join(' AND ')}`
  const count = store.db.prepare(`SELECT COUNT(*) AS count ${from}`).get(...params) as {
    count: number
  }
  const rows = store.db
    .prepare(
      `SELECT a.value_json AS asset,m.value_json AS meta ${from} ORDER BY a.rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.limit, input.offset) as Array<{ asset: string; meta: string | null }>
  return {
    total: count.count,
    items: rows.map((row) => ({
      ...(JSON.parse(row.asset) as Asset),
      meta: row.meta
        ? (JSON.parse(row.meta) as AssetMeta)
        : { id: (JSON.parse(row.asset) as Asset).id, revision: 0 },
    })),
  }
}
function references(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if ('assetId' in value && typeof value.assetId === 'string') return [value.assetId]
  return [...new Set(Object.values(value).flatMap(references))]
}
/** 为升级前的成功输出补建索引，文件仍使用原来的内容寻址资源。 */
function indexExistingArtworks(store: Store, owner: string) {
  const select = store.db.prepare(
    "SELECT r.value_json FROM runs r WHERE r.owner=? AND r.state IN ('completed','partial') AND NOT EXISTS (SELECT 1 FROM entities e WHERE e.owner=r.owner AND e.kind='artwork-index' AND e.id=r.id) LIMIT 100",
  )
  for (;;) {
    const rows = select.all(owner) as Array<{ value_json: string }>
    if (!rows.length) return
    store.transaction(() => {
      for (const row of rows) {
        const run = JSON.parse(row.value_json) as Run
        for (const id of references(run.result)) {
          try {
            store.asset(id, owner)
          } catch {
            continue
          }
          const node = run.nodes.find((node) => references(node.outputs).includes(id))
          let inputs = run.inputs
          if (node) {
            try {
              inputs = Object.fromEntries(
                Object.entries(node.inputs).map(([key, binding]) => [
                  key,
                  resolve(binding, run.inputs, run.nodes),
                ]),
              )
            } catch {
              /* 历史输入缺失时保留任务根输入。 */
            }
          }
          recordArtwork(
            store,
            owner,
            id,
            run,
            node?.step.id || '',
            node?.service?.submit.body.model,
            inputs,
          )
        }
        store.put(owner, 'artwork-index', { id: run.id }, 0)
      }
    })
  }
}
export function updateLibrary(store: Store, owner: string, raw: unknown) {
  const input = z
    .object({
      id: identifier,
      expectedRevision: z.number().int().nonnegative(),
      title: z.string().trim().min(1).max(180).optional(),
      favorite: z.boolean().optional(),
      final: z.boolean().optional(),
      tags: z.array(z.string().max(50)).max(30).optional(),
    })
    .strict()
    .parse(raw)
  store.asset(input.id, owner)
  const { expectedRevision, ...patch } = input
  return store.put(
    owner,
    'asset-meta',
    { ...store.get<AssetMeta>(owner, 'asset-meta', input.id), ...patch },
    expectedRevision,
  )
}
export function recordArtwork(
  store: Store,
  owner: string,
  assetId: string,
  run: Run,
  stepId: string,
  model: unknown,
  inputs: Record<string, unknown>,
) {
  const previous = store.get<AssetMeta>(owner, 'asset-meta', assetId)
  if (previous?.origin === 'output' && previous.runId === run.id) return
  store.put(
    owner,
    'asset-meta',
    {
      ...previous,
      id: assetId,
      origin: 'output' as const,
      runId: run.id,
      stepId,
      model: typeof model === 'string' ? model : undefined,
      inputs,
      createdAt: run.createdAt,
    },
    previous?.revision ?? 0,
  )
}

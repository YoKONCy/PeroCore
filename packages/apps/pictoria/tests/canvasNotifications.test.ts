import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PictoriaApplication } from '../src/application'
import { readDismissedCanvasRuns } from '../src/canvasNotificationState'
import { Store } from '../src/store'
import type { Run } from '../src/domain'

const fixtures: Array<{ root: string; store: Store }> = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.db.close()
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'pictoria-notifications-'))
  const store = new Store(
    root,
    fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
  )
  fixtures.push({ root, store })
  return { root, store, app: new PictoriaApplication(store) }
}
function run(id: string, owner: string): Run {
  return {
    id,
    owner,
    projectId: 'canvas',
    name: '图像编辑',
    state: 'failed',
    revision: 0,
    inputs: {},
    nodes: [],
    outputs: {},
    outputSchema: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('画布任务通知可见性', () => {
  it('空画布移除任务后，在线与离线查询都隐藏旧通知，执行历史仍保留', async () => {
    const { app, store, root } = setup()
    store.saveRun(run('old-failure', 'lin'))
    await app.invoke(
      'project.save',
      {
        definition: { id: 'canvas', title: '空画布', items: [], dismissedRunIds: ['old-failure'] },
      },
      { owner: 'lin' },
    )
    expect(await app.invoke('task.dismissed', {}, { owner: 'lin' })).toEqual(['old-failure'])
    expect(readDismissedCanvasRuns(root, 'lin')).toEqual(['old-failure'])
    expect(readDismissedCanvasRuns(root, 'pero')).toEqual([])
    expect(store.run('old-failure', 'lin')?.state).toBe('failed')
    const restored = await app.invoke(
      'project.save',
      {
        definition: { id: 'canvas', title: '撤销删除', items: [], dismissedRunIds: [] },
        expectedRevision: 1,
      },
      { owner: 'lin' },
    )
    expect(restored).toBeTruthy()
    expect(readDismissedCanvasRuns(root, 'lin')).toEqual([])
  })

  it('删除整个画布也停止提醒该画布的任务，保留其他角色及所有执行记录', async () => {
    const { app, store, root } = setup()
    store.saveRun(run('mine', 'lin'))
    store.saveRun(run('other', 'pero'))
    await app.invoke(
      'project.save',
      { definition: { id: 'canvas', title: '即将删除', items: [] } },
      { owner: 'lin' },
    )
    await app.invoke('project.delete', { id: 'canvas', expectedRevision: 1 }, { owner: 'lin' })
    expect(readDismissedCanvasRuns(root, 'lin')).toEqual(['mine'])
    expect(readDismissedCanvasRuns(root, 'pero')).toEqual([])
    expect(store.runs()).toHaveLength(2)
  })
})

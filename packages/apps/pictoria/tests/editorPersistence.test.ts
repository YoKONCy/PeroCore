import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PictoriaApplication } from '../src/application'
import { Store } from '../src/store'
import type { Project } from '../client/src/types'
import type { WorkflowDraft } from '../src/workflowDrafts'

const scope = { owner: 'editor-test-owner', callId: 'editor-test-call' }
const fixtures: Array<{ store: Store; app: PictoriaApplication }> = []
function fixture() {
  const store = new Store(
    mkdtempSync(path.join(tmpdir(), 'pictoria-editor-')),
    fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
  )
  const app = new PictoriaApplication(store)
  fixtures.push({ store, app })
  return { store, app }
}
afterEach(async () => {
  for (const { store, app } of fixtures.splice(0)) {
    await app.execution.stop()
    store.close()
    if (path.dirname(path.resolve(store.root)) !== path.resolve(tmpdir()))
      throw new Error('临时目录越界')
    rmSync(store.root, { recursive: true, force: true })
  }
})

describe('编辑器参数持久化', () => {
  it('画布保存并恢复每个节点与创作栏各步骤的嵌套配置', async () => {
    const { app, store } = fixture()
    const inputs = {
      aspect_ratio: '16:9',
      resolution: '2K',
      thinking: { enabled: false, budget: 0 },
    }
    const definition = {
      id: 'canvas-preferences',
      title: '参数画布',
      items: [
        {
          id: 'node-preferences',
          x: 10,
          y: 20,
          content: { version: 1, kind: 'draft', width: 280, height: 200, inputs },
        },
      ],
      creation: {
        stepId: 'step-one',
        text: '提示词',
        inputsByStep: { 'step-one': inputs, 'step-two': { aspect_ratio: '1:1', thinking: true } },
      },
    }
    const saved = (await app.invoke(
      'project.save',
      { definition, expectedRevision: 0 },
      scope,
    )) as Project
    expect(
      store.get<Project>(scope.owner, 'project', definition.id)?.items[0]?.content.inputs,
    ).toEqual(inputs)
    const restored = (await app.invoke('project.get', { id: saved.id }, scope)) as Project
    expect(restored.creation).toEqual(definition.creation)
    // 旧客户端只更新画布内容时，不应丢失新版客户端保存的创作参数。
    const { creation: _creation, ...legacy } = definition
    const updated = (await app.invoke(
      'project.save',
      { definition: legacy, expectedRevision: saved.revision },
      scope,
    )) as Project
    expect(updated.creation).toEqual(definition.creation)
  })

  it('工作流草稿往返保留节点固定值与试运行配置', async () => {
    const { app } = fixture()
    const definition = {
      id: 'workflow-preferences',
      name: '参数工作流',
      nodes: [
        {
          id: 'node-one',
          stepId: 'step-one',
          stepRevision: 1,
          inputs: {
            aspect_ratio: { literal: '3:2' },
            resolution: { literal: '4K' },
            thinking: { literal: { enabled: true, budget: 2048 } },
          },
        },
      ],
      testInputs: { aspect_ratio: '9:16', resolution: '2K', thinking: false },
    }
    const saved = (await app.invoke(
      'workflow.draft.save',
      { definition, expectedRevision: 0 },
      scope,
    )) as WorkflowDraft
    const restored = (await app.invoke(
      'workflow.draft.get',
      { id: saved.id },
      scope,
    )) as WorkflowDraft
    expect(restored.nodes[0]?.inputs).toEqual(definition.nodes[0]!.inputs)
    expect(restored.testInputs).toEqual(definition.testInputs)
  })
})

import { describe, expect, it } from 'vitest'
import type { SurfaceNode } from '@infos/shared'
import { usePetActivity } from '@infos/frontend/composables/pet/usePetActivity'

function node(id: string, kind: SurfaceNode['kind'], props: object): SurfaceNode {
  return { nodeId: id as SurfaceNode['nodeId'], kind, revision: 1, lifecycle: 'stable', props }
}
function call(id: string, name: string, parentCallId?: string) {
  return node(id, 'tool-call', {
    callId: id,
    name,
    parentCallId,
    state: 'calling',
    args: '{"private":"参数内容"}',
  })
}

describe('桌宠轻量活动投影', () => {
  it('NIT 只计算真实子工具，单步失败不截断其他轨迹', () => {
    const activity = usePetActivity()
    activity.reset(true)
    activity.node(call('nit', 'run_script'))
    expect(activity.activity.value.steps).toHaveLength(0)
    activity.node(call('read', 'read_file', 'nit'))
    activity.node(call('search', 'search_files', 'nit'))
    activity.node(call('write', 'write_file', 'nit'))
    activity.node(
      node('result-read', 'tool-result', { callId: 'read', isError: false, result: '文件正文' }),
    )
    activity.node(
      node('result-search', 'tool-result', { callId: 'search', isError: true, result: '详细错误' }),
    )
    expect(activity.activity.value.nit).toBe(true)
    expect(activity.activity.value.steps.map((step) => step.state)).toEqual([
      'completed',
      'failed',
      'running',
    ])
    expect(JSON.stringify(activity.activity.value)).not.toMatch(/参数内容|文件正文|详细错误/)
  })
  it('结果提前到达后，重放调用不能让完成状态退回运行', () => {
    const activity = usePetActivity()
    activity.node(node('result', 'tool-result', { callId: 'read', isError: false }))
    activity.node(call('read', 'read_file'))
    expect(activity.activity.value.steps[0]?.state).toBe('completed')
  })
  it('不同回合清空轨迹与节点索引，状态补丁结束活动', () => {
    const activity = usePetActivity()
    activity.node(call('old', 'read_file'))
    activity.reset(true)
    activity.node(node('status', 'status', { state: 'generating' }))
    expect(activity.activity.value.steps).toHaveLength(0)
    activity.patch('status', { state: 'completed' })
    expect(activity.activity.value.phase).toBe('idle')
  })
  it('原生思考与碎碎念只切换状态，不保留正文', () => {
    const activity = usePetActivity()
    activity.node(node('reason', 'native-reasoning', { source: '思考正文', phase: 'preview' }))
    expect(activity.activity.value.phase).toBe('thinking')
    expect(JSON.stringify(activity.activity.value)).not.toContain('思考正文')
    activity.node(node('text', 'markdown', { source: '答复正文', phase: 'preview' }))
    expect(activity.activity.value.phase).toBe('generating')
    activity.finish()
    expect(activity.activity.value.phase).toBe('idle')
  })
})

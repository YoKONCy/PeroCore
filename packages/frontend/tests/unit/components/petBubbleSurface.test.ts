// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import type { SurfaceId, SurfaceNodeId } from '@infos/shared'
import PetBubbleSurface from '@infos/frontend/components/pet/PetBubbleSurface.vue'

function surface(nodes: Array<Record<string, unknown>>) {
  return {
    surfaceId: 'pet-surface' as SurfaceId,
    generation: 'generation-1',
    threadId: 'thread-1',
    principalId: 'pero',
    revision: 1,
    sequence: 1,
    state: 'open' as const,
    operationIds: new Set<string>(),
    nodes: nodes.map((node, index) => ({
      nodeId: `pet-node:${index}` as SurfaceNodeId,
      revision: 1,
      lifecycle: 'stable' as const,
      ...node,
    })),
  }
}

function mountSurface(nodes: Array<Record<string, unknown>>) {
  return mount(PetBubbleSurface, {
    props: { surface: surface(nodes) },
    global: { plugins: [createPinia()] },
  })
}

describe('PetBubbleSurface', () => {
  it('应使用与 Conversation 相同的 Markdown Surface 节点渲染正文', () => {
    const wrapper = mountSurface([
      {
        kind: 'markdown',
        props: { source: '**你好**，主人', phase: 'committed' },
      },
    ])

    expect(wrapper.text()).toContain('你好，主人')
  })

  it('没有正文时应紧凑显示结构化工具状态', () => {
    const wrapper = mountSurface([
      {
        kind: 'tool-call',
        lifecycle: 'interactive',
        props: { callId: 'call-1', name: '搜索资料', args: '{}', state: 'calling' },
      },
    ])

    expect(wrapper.text()).toBe('正在使用工具：搜索资料')
    expect(wrapper.text()).not.toContain('{}')
  })

  it('Pet3D应实时消费状态和台词推送，不依赖页面刷新', async () => {
    const root = resolve(process.cwd(), 'packages/frontend/src')
    const [gateway, texts, store] = await Promise.all([
      readFile(resolve(root, 'composables/pet/usePetGateway.ts'), 'utf8'),
      readFile(resolve(root, 'composables/pet/usePetTexts.ts'), 'utf8'),
      readFile(resolve(root, 'stores/usePetStateStore.ts'), 'utf8'),
    ])

    expect(gateway).toContain("onPush('state_update', handleStateUpdate)")
    expect(gateway).toContain("offPush('state_update', handleStateUpdate)")
    expect(gateway).toContain('petStateStore.apply(updateAgentId')
    expect(texts).toContain("onPush('state_update', applyStateTexts)")
    expect(texts).toContain('localTexts.value[`click_${part}_all`]')
    expect(texts).toContain('loadDynamicTexts({ agentId: targetAgentId, showWelcome: false })')
    expect(store).toContain('const loadGenerations = new Map<string, number>()')
  })

  it('错误节点应优先于普通状态显示', () => {
    const wrapper = mountSurface([
      { kind: 'status', props: { state: 'thinking' } },
      { kind: 'error', props: { code: 'FAILED', message: '回复失败了' } },
    ])

    expect(wrapper.text()).toBe('回复失败了')
  })
})

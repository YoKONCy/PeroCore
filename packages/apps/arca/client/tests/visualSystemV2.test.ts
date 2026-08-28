// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import type { DocumentNode, DocumentNodeId, DocumentSemanticDiff } from '@infos/document-engine'
import SemanticDocument from '../src/components/SemanticDocument.vue'

const rootNodeId = 'root' as DocumentNodeId
const paragraphId = 'paragraph-1' as DocumentNodeId
const nodes: DocumentNode[] = [
  {
    nodeId: rootNodeId,
    documentId: 'document-1' as never,
    type: 'document-root',
    parentId: null,
    orderKey: 'a',
    generation: 1,
    attributes: {},
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  },
  {
    nodeId: paragraphId,
    documentId: 'document-1' as never,
    type: 'paragraph',
    parentId: rootNodeId,
    orderKey: 'a',
    generation: 1,
    text: '原始星页正文',
    attributes: {},
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  },
]

function mountDocument(overrides: Record<string, unknown> = {}) {
  return mount(SemanticDocument, {
    props: {
      nodes,
      rootNodeId,
      writable: true,
      mode: 'create',
      ...overrides,
    },
  })
}

describe('SemanticDocument Visual System V3', () => {
  it('创作模式应使用原生可选取编辑面并提交真实语义节点', async () => {
    localStorage.setItem('arca-auto-save-delay', '0')
    const wrapper = mountDocument()
    const editor = wrapper.get('.document-paragraph')
    expect(editor.attributes('contenteditable')).toBe('plaintext-only')
    editor.element.textContent = '修改后的星页正文'
    await editor.trigger('input')
    await editor.trigger('blur')

    expect(wrapper.emitted('draft')?.at(-1)).toEqual([paragraphId, '修改后的星页正文'])
    expect(wrapper.emitted('commit')?.at(-1)).toEqual([paragraphId])
    expect(wrapper.get('.semantic-block').attributes('data-node-id')).toBe(paragraphId)
  })

  it('中文输入法组合期间失焦不得提交中间文本', async () => {
    const wrapper = mountDocument()
    const editor = wrapper.get('.document-paragraph')
    await editor.trigger('compositionstart')
    editor.element.textContent = '组合中的文本'
    await editor.trigger('input')
    await editor.trigger('blur')

    expect(wrapper.emitted('commit')).toBeUndefined()
    await editor.trigger('compositionend')
    await editor.trigger('blur')
    expect(wrapper.emitted('commit')?.at(-1)).toEqual([paragraphId])
  })

  it('阅读模式保持文本可选择但不可修改', () => {
    const wrapper = mountDocument({ mode: 'read' })
    const content = wrapper.get('.document-paragraph')
    expect(content.attributes('contenteditable')).toBe('false')
    expect(content.classes()).toContain('editable-node')
  })

  it('审阅模式应在正文语境内展示Semantic Diff', async () => {
    const diff: DocumentSemanticDiff = {
      documentId: 'document-1' as never,
      changeSetId: 'changeset-1' as never,
      fromRevisionId: 'revision-1' as never,
      effects: [],
      generatedAt: '2026-08-18T00:00:00.000Z',
      textChanges: [{ nodeId: paragraphId, before: '原始星页正文', after: '协作者建议正文' }],
      summary: {
        insertedNodes: 0,
        deletedNodes: 0,
        movedNodes: 0,
        changedTextNodes: 1,
        changedAttributes: 0,
        renamedDocuments: 0,
      },
    }
    const wrapper = mountDocument({ mode: 'review', diff })
    await nextTick()

    expect(wrapper.get('.inline-semantic-diff del').text()).toBe('原始星页正文')
    expect(wrapper.get('.inline-semantic-diff ins').text()).toBe('协作者建议正文')
    expect(wrapper.get('.semantic-block').classes()).toContain('semantic-block--changed')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })
})

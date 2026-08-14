import { describe, expect, it } from 'vitest'
import { buildToolDiff } from '@infos/backend/tools/fileOps'

describe('write_file 工具 Diff 预览', () => {
  it('新建 Markdown 文件应按实际行数统计为纯新增', () => {
    const result = buildToolDiff('', '# 标题\n\n第一段\n')
    expect(result.insertions).toBe(3)
    expect(result.deletions).toBe(0)
    expect(result.diffPreview).toEqual([
      { kind: 'add', newLine: 1, text: '# 标题' },
      { kind: 'add', newLine: 2, text: '' },
      { kind: 'add', newLine: 3, text: '第一段' },
    ])
  })

  it('覆盖文件应同时生成红色删除行和绿色新增行', () => {
    const result = buildToolDiff('# 标题\n旧内容\n结尾\n', '# 标题\n新内容\n结尾\n')
    expect(result).toMatchObject({ insertions: 1, deletions: 1, diffTruncated: false })
    expect(result.diffPreview.some((row) => row.kind === 'remove' && row.text === '旧内容')).toBe(
      true,
    )
    expect(result.diffPreview.some((row) => row.kind === 'add' && row.text === '新内容')).toBe(true)
  })

  it('追加内容应只统计新增行', () => {
    const result = buildToolDiff('第一行\n', '第一行\n第二行\n第三行\n')
    expect(result.insertions).toBe(2)
    expect(result.deletions).toBe(0)
    expect(result.diffPreview.filter((row) => row.kind === 'add')).toHaveLength(2)
  })

  it('预览应限制行数和单行长度，但总统计保持完整', () => {
    const content = Array.from({ length: 100 }, (_, index) => `${index}-${'x'.repeat(700)}`).join(
      '\n',
    )
    const result = buildToolDiff('', content)
    expect(result.insertions).toBe(100)
    expect(result.diffPreview).toHaveLength(80)
    expect(result.diffPreview[0]!.text.length).toBe(501)
    expect(result.diffTruncated).toBe(true)
  })
})

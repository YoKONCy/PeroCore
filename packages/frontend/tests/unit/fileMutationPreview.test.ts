import { describe, expect, it } from 'vitest'
import { parseStreamingToolArguments } from '@infos/shared'
import { fileMutationPreview } from '../../src/composables/tools/useFileMutationPreview'

describe('折叠与展开共用的文件变更统计', () => {
  it('新文件流式正文逐段计数，真实执行结果覆盖预览', () => {
    const source = {
      toolName: 'write_file',
      assembling: true,
      fileBaseline: { path: 'a.txt', status: 'new' as const },
    }
    const first = fileMutationPreview({
      ...source,
      args: '{"file_path":"a.txt","content":"一行\\n',
    })
    expect(first).toMatchObject({ insertions: 1, deletions: 0, available: true, committed: false })
    const args = JSON.stringify({ file_path: 'a.txt', content: '一行\n二行\n三行\n' })
    expect(fileMutationPreview({ ...source, args: args.slice(0, -2) })).toMatchObject({
      insertions: 3,
      deletions: 0,
    })
    expect(
      fileMutationPreview({
        ...source,
        args,
        result: JSON.stringify({
          success: true,
          insertions: 4,
          deletions: 2,
          diffPreview: [],
          diffTruncated: true,
        }),
      }),
    ).toMatchObject({ insertions: 4, deletions: 2, committed: true, baselineUnknown: false })
  })

  it('新文尚未到达不提前报告整段删除，闭合的空字符串才视为删除', () => {
    const args = '{"path":"a.txt","old_text":"旧一\\n旧二","new_text":"'
    expect(fileMutationPreview({ toolName: 'edit_file', args })).toMatchObject({
      available: false,
      deletions: 0,
    })
    expect(fileMutationPreview({ toolName: 'edit_file', args: args + '"}' })).toMatchObject({
      insertions: 0,
      deletions: 2,
    })
  })

  it('批量步骤尚未闭合时也更新，字符串里的花括号不切断步骤', () => {
    const source = {
      path: 'a.ts',
      steps: [
        { old_text: '旧一', new_text: 'const x = { a: "}" };' },
        { old_text: '旧二', new_text: '新二\n新三' },
      ],
    }
    const args = JSON.stringify(source).slice(0, -4)
    const parsed = parseStreamingToolArguments(args)
    expect(parsed.values.steps).toHaveLength(2)
    expect(parsed.stepCompleteFields?.[1]?.has('new_text')).toBe(false)
    expect(fileMutationPreview({ toolName: 'edit_file', args })).toMatchObject({
      insertions: 3,
      deletions: 2,
    })
    const emptyDraft = '{"steps":[{"old_text":"旧文","new_text":"'
    expect(fileMutationPreview({ toolName: 'edit_file', args: emptyDraft })).toMatchObject({
      available: false,
      deletions: 0,
    })
  })

  it('引用和行范围只比较目标片段，未知旧文不伪装成删除零行', () => {
    const baseline = {
      path: 'a.txt',
      status: 'ready' as const,
      hash: 'v1',
      content: '保留\n旧一\n旧二\n末尾',
      selections: { 'read:1': '旧一\n旧二' },
    }
    for (const args of [
      { read_ref: 'read:1', new_text: '新内容' },
      { path: 'a.txt', expected_hash: 'v1', line_start: 2, line_end: 3, new_text: '新内容' },
    ]) {
      expect(
        fileMutationPreview({
          toolName: 'edit_file',
          args: JSON.stringify(args),
          fileBaseline: baseline,
        }),
      ).toMatchObject({ insertions: 1, deletions: 2, baselineUnknown: false })
    }
    expect(
      fileMutationPreview({
        toolName: 'edit_file',
        args: '{"read_ref":"read:1","new_text":"新内容',
      }),
    ).toMatchObject({ insertions: 1, baselineUnknown: true, committed: false })
  })

  it('失败与等待候选选择不能显示为已写入，不能采用错误回执里的统计', () => {
    const args = JSON.stringify({ path: 'a.txt', old_text: '旧文', new_text: '新文' })
    for (const result of [
      { success: false, needsSelection: true },
      { success: false, error: '写入失败' },
    ]) {
      expect(
        fileMutationPreview({
          toolName: 'edit_file',
          args,
          result: JSON.stringify({
            ...result,
            insertions: 999,
            deletions: 999,
          }),
        }),
      ).toMatchObject({ insertions: 1, deletions: 1, committed: false })
    }
  })
})

import { describe, expect, it } from 'vitest'
import { reviseEventNoteTool, writeEventNoteTool } from '@infos/backend/tools/eventMemory'

const draft = {
  importance: 6,
  affect: { tones: [], valence: 5, arousal: 0 },
}

describe.each([writeEventNoteTool, reviseEventNoteTool])('$name 的记事视角', (tool) => {
  it.each([
    'Pero 和主人约定每周复盘。',
    '用户向助手表达了稳定偏好。',
    '主人说：“我下周要搬家。”',
    '主人告诉我下周要搬家。',
    '“我会记住的。”这是助手的回复。',
    'It was agreed that the user would move next week.',
  ])('拒绝旁观叙述并返回重写说明：%s', async (narrative) => {
    await expect(
      tool.execute({ ...draft, targetId: 'note-1', narrative }, {} as never),
    ).rejects.toThrow('请根据真实对话重写后重新调用工具')
  })

  it.each([
    '我和主人约定每周复盘。',
    '我得知小林下周要搬家。',
    '我听主人说，他不喜欢太甜的饮料。',
    'I learned that Lin is moving next week.',
    'I’m going to review the plan with my owner every week, as we agreed.',
  ])('保留合规正文及他人的事实归属：%s', async (narrative) => {
    const output = await tool.execute(
      { ...draft, targetId: 'note-1', narrative: `  ${narrative}\n` },
      {} as never,
    )
    expect(JSON.parse(output as string)).toMatchObject({
      accepted: true,
      draft: { narrative },
      commit: 'after_assistant_persisted',
    })
  })

  it('视角纠正后可重新提交，不接受空正文', async () => {
    await expect(
      tool.execute({ ...draft, targetId: 'note-1', narrative: '  ' }, {} as never),
    ).rejects.toThrow('事件记叙不能为空')
    await expect(
      tool.execute({ ...draft, targetId: 'note-1', narrative: '用户喜欢红茶。' }, {} as never),
    ).rejects.toThrow('事件记叙视角不符合要求')
    const output = await tool.execute(
      { ...draft, targetId: 'note-1', narrative: '我记住了主人喜欢红茶。' },
      {} as never,
    )
    expect(JSON.parse(output as string).accepted).toBe(true)
  })
})

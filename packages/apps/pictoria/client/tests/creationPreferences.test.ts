import { describe, expect, it } from 'vitest'
import { normalizeCreationPreferences } from '../src/services/creationPreferences'

describe('Pictoria 草稿创作参数', () => {
  it.each([undefined, null, {}, [], { inputsByStep: null }])(
    '不完整草稿仍可打开画布：%j',
    (value) => {
      expect(normalizeCreationPreferences(value)).toEqual({
        stepId: '',
        text: '',
        inputsByStep: {},
      })
    },
  )

  it('保留有效模型配置并丢弃损坏的参数分组', () => {
    expect(
      normalizeCreationPreferences({
        stepId: 'image',
        text: '海边',
        inputsByStep: { image: { aspectRatio: '16:9', resolution: '2k' }, invalid: null },
      }),
    ).toEqual({
      stepId: 'image',
      text: '海边',
      inputsByStep: { image: { aspectRatio: '16:9', resolution: '2k' } },
    })
  })
})

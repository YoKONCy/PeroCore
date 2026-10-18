/** 仅用于呈现的少量预设，不回写或量化 Agent 的情绪。 */
export type CharacterExpression = 'neutral' | 'bright' | 'subdued' | 'concerned' | 'focused' | 'shy'

export interface CharacterExpressionPose {
  eyelid: number
  eyebrow: number
  pitch: number
  tilt: number
}

export const CHARACTER_EXPRESSION_POSES: Record<CharacterExpression, CharacterExpressionPose> = {
  neutral: { eyelid: 1, eyebrow: 0, pitch: 0, tilt: 0 },
  bright: { eyelid: 0.94, eyebrow: 0.12, pitch: -1, tilt: 1 },
  subdued: { eyelid: 0.97, eyebrow: 0.16, pitch: 2, tilt: 0 },
  concerned: { eyelid: 1.03, eyebrow: 0.2, pitch: 0.5, tilt: -1 },
  focused: { eyelid: 0.98, eyebrow: -0.12, pitch: 0.5, tilt: 0 },
  shy: { eyelid: 0.93, eyebrow: 0.1, pitch: 1, tilt: 1.5 },
}

const EXPRESSION_WORDS: Record<CharacterExpression, readonly string[]> = {
  neutral: ['平静', '轻松', '自然', '安静', '沉静', 'calm', 'relaxed', 'neutral'],
  bright: ['开心', '快乐', '愉快', '高兴', '兴奋', '雀跃', '活泼', 'happy', 'cheerful', 'excited'],
  subdued: ['失落', '低落', '难过', '伤心', '沮丧', 'sad', 'down', 'disappointed'],
  concerned: ['担心', '担忧', '忧虑', '不安', 'worried', 'concerned', 'uneasy'],
  focused: ['认真', '专注', '严肃', 'focused', 'serious', 'attentive'],
  shy: ['害羞', '羞涩', '腼腆', 'shy', 'bashful'],
}

function expressionFor(text: string | undefined): CharacterExpression | undefined {
  const word = (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[。！!，,\s]+$/u, '')
    .replace(/^(?:有一点|有点|有些|略微|略有|稍微|比较|非常|十分|微微|很)/u, '')
  return (Object.keys(EXPRESSION_WORDS) as CharacterExpression[]).find((expression) =>
    EXPRESSION_WORDS[expression].includes(word),
  )
}

/** 只接受明确描述，否定句、混合心境和未知文字保留自然待机。 */
export function resolveCharacterExpression(mood?: string, vibe?: string): CharacterExpression {
  const emotion = expressionFor(mood)
  if (mood?.trim() && !emotion) return 'neutral'
  if (emotion && emotion !== 'neutral') return emotion
  return expressionFor(vibe) ?? emotion ?? 'neutral'
}

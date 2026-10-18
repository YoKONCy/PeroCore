/** 字幕只呈现正在播报的短句；字符预算避免缺少标点时撑成长篇浮层。 */
export function splitSpokenCaptions(text: string): string[] {
  const sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) ?? []
  return sentences.flatMap((sentence) => {
    const characters = [...sentence.trim()]
    const chunks: string[] = []
    for (let index = 0; index < characters.length; index += 32)
      chunks.push(characters.slice(index, index + 32).join(''))
    return chunks
  })
}

const asset = {
  type: 'object',
  properties: { assetId: { type: 'string' } },
  required: ['assetId'],
  additionalProperties: false,
}
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const definitions = [
  {
    id: 'image-generate',
    name: '图像生成',
    input: object({ prompt: { type: 'string' } }, ['prompt']),
    output: object({ image: asset }, ['image']),
  },
  {
    id: 'image-edit',
    name: '图像编辑',
    input: object({ image: asset, prompt: { type: 'string' } }, ['image', 'prompt']),
    output: object({ image: asset }, ['image']),
  },
  {
    id: 'video-generate',
    name: '视频生成',
    input: object({ image: asset, prompt: { type: 'string' } }, ['prompt']),
    output: object({ video: asset }, ['video']),
  },
  {
    id: 'background-remove',
    name: '抠图',
    input: object({ image: asset }, ['image']),
    output: object({ image: asset }, ['image']),
  },
  {
    id: 'upscale',
    name: '超分',
    input: object({ image: asset, scale: { type: 'number', minimum: 1, maximum: 8 } }, ['image']),
    output: object({ image: asset }, ['image']),
  },
  {
    id: 'llm-analysis',
    name: 'LLM 分析',
    input: object({ image: asset, prompt: { type: 'string' } }, ['prompt']),
    output: object({ text: { type: 'string' } }, ['text']),
  },
]

/** 模板只提供可编辑起点，不假设实际模型的提示词格式，也不自动启用。 */
export function stepTemplates() {
  return definitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    enabled: false,
    inputSchema: definition.input,
    outputSchema: definition.output,
    usageDescription: '请填写所用服务、模型及各输入字段的使用要求。',
    implementation: { kind: 'service', serviceId: 'configure-service' },
  }))
}

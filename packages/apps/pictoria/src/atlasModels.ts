type Fields = Record<string, Record<string, unknown>>
export interface AtlasModel {
  id: string
  name: string
  model: string
  mode: 'generate' | 'edit'
  maxImages: number
  imageField?: string
  promptLimit?: number
  sync?: boolean
  gif?: boolean
  fields: Fields
  docs: string
}
const choice = (title: string, values: string[], fallback?: string) => ({
  type: 'string',
  title,
  enum: values,
  ...(fallback === undefined ? {} : { default: fallback }),
})
const seed = { type: 'integer', title: '随机种子', minimum: -1, maximum: 2147483647, default: -1 }
const format = choice('图片格式', ['png', 'jpeg'], 'png')
const ratios = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const media = choice('参考图精度', ['default', 'low', 'medium', 'high'], 'default')
const google = {
  aspect_ratio: choice('画面比例', ratios, '1:1'),
  output_format: format,
  media_resolution: media,
  seed,
  top_p: { type: 'number', title: 'Top P', minimum: 0, maximum: 1, default: 0.95 },
  temperature: { type: 'number', title: '温度', minimum: 0, maximum: 1, default: 1 },
} satisfies Fields
const pro = {
  ...google,
  resolution: choice('分辨率', ['1k', '2k', '4k'], '2k'),
  enable_web_search: { type: 'boolean', title: '联网搜索', default: false },
} satisfies Fields
const seedream: Fields = {
  size: choice(
    '画面尺寸',
    [
      '2048*2048',
      '2368*1776',
      '1776*2368',
      '2816*1584',
      '1584*2816',
      '2496*1664',
      '1664*2496',
      '3136*1344',
      '1024*1024',
      '1536*1536',
      '1776*1328',
      '1328*1776',
      '2048*1152',
      '1152*2048',
    ],
    '2048*2048',
  ),
  output_format: format,
  thinking: choice('深度思考', ['enabled', 'disabled'], 'enabled'),
  prompt_optimization_mode: choice('提示词优化', ['standard', 'fast'], 'standard'),
}
const seedream45Sizes = [
  '2048*2048',
  '2304*1728',
  '1728*2304',
  '2848*1600',
  '1600*2848',
  '2496*1664',
  '1664*2496',
  '3136*1344',
  '4096*4096',
  '4704*3520',
  '3520*4704',
  '5504*3040',
  '3040*5504',
  '4992*3328',
  '3328*4992',
  '6240*2656',
]
const seedreamLiteSizes = [
  ...seedream45Sizes.slice(0, 8),
  '3072*3072',
  '3456*2592',
  '2592*3456',
  '4096*2304',
  '2304*4096',
  '2496*3744',
  '3744*2496',
  '4704*2016',
]
const flux: Fields = {
  size: {
    type: 'string',
    title: '画面尺寸',
    pattern: '^(?:[2-9]\\d{2}|1\\d{3}|20[0-4]\\d)\\*(?:[2-9]\\d{2}|1\\d{3}|20[0-4]\\d)$',
  },
  output_format: format,
  seed,
  safety_tolerance: { type: 'integer', title: '容忍度', minimum: 0, maximum: 5, default: 2 },
}
const docs = (path: string) => `https://www.atlascloud.ai/docs/more-models/${path}/generateImage`
// 各型号分别声明接口字段，避免把一个模型的参数和参考图上限套到另一个模型。
export const atlasModels: AtlasModel[] = [
  ...(['generate', 'edit'] as const).flatMap((mode) => [
    {
      id: 'nano-banana-pro',
      name: 'Nano Banana Pro',
      model: `google/nano-banana-pro/${mode === 'edit' ? 'edit' : 'text-to-image'}`,
      mode,
      maxImages: 10,
      sync: true,
      fields:
        mode === 'edit'
          ? pro
          : {
              aspect_ratio: google.aspect_ratio,
              resolution: pro.resolution,
              output_format: format,
              seed,
            },
      docs: docs(`google/nano-banana-pro-${mode === 'edit' ? 'edit' : 'text-to-image'}`),
    },
    {
      id: 'seedream-v5-pro',
      name: 'Seedream 5.0 Pro',
      model: `bytedance/seedream-v5.0-pro/${mode === 'edit' ? 'edit' : 'text-to-image'}`,
      mode,
      maxImages: 10,
      gif: true,
      fields: seedream,
      docs: docs(`bytedance/seedream-v5.0-pro-${mode === 'edit' ? 'edit' : 'text-to-image'}`),
    },
  ]),
  {
    id: 'nano-banana',
    name: 'Nano Banana',
    model: 'google/nano-banana/edit',
    mode: 'edit',
    maxImages: 10,
    sync: true,
    fields: google,
    docs: docs('google/nano-banana-edit'),
  },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    model: 'google/nano-banana-2/edit',
    mode: 'edit',
    maxImages: 14,
    sync: true,
    fields: {
      ...pro,
      enable_image_search: { type: 'boolean', title: '图片搜索', default: false },
      thinking_level: choice('思考等级', ['default', 'high', 'minimal'], 'default'),
    },
    docs: docs('google/nano-banana-2-edit'),
  },
  {
    id: 'seedream-v4.5',
    name: 'Seedream 4.5',
    model: 'bytedance/seedream-v4.5/edit',
    mode: 'edit',
    maxImages: 10,
    fields: { size: choice('画面尺寸', seedream45Sizes, '2048*2048') },
    docs: docs('bytedance/seedream-v4.5-edit'),
  },
  {
    id: 'seedream-v5-lite',
    name: 'Seedream 5.0 Lite',
    model: 'bytedance/seedream-v5.0-lite/edit',
    mode: 'edit',
    maxImages: 14,
    gif: true,
    fields: { size: choice('画面尺寸', seedreamLiteSizes, '2048*2048'), output_format: format },
    docs: docs('bytedance/seedream-v5.0-lite-edit'),
  },
  {
    id: 'flux-2-pro',
    name: 'FLUX.2 Pro',
    model: 'black-forest-labs/flux-2-pro/edit',
    mode: 'edit',
    maxImages: 8,
    sync: true,
    fields: flux,
    docs: docs('black-forest-labs/flux-2-pro-edit'),
  },
  {
    id: 'flux-2-flex',
    name: 'FLUX.2 Flex',
    model: 'black-forest-labs/flux-2-flex/edit',
    mode: 'edit',
    maxImages: 8,
    sync: true,
    fields: {
      ...flux,
      enable_prompt_expansion: { type: 'boolean', title: '提示词扩展', default: true },
      guidance_scale: { type: 'number', title: '引导强度', minimum: 1.5, maximum: 10, default: 5 },
      num_inference_steps: { type: 'integer', title: '步数', minimum: 1, maximum: 50, default: 50 },
    },
    docs: docs('black-forest-labs/flux-2-flex-edit'),
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    model: 'openai/gpt-image-2/edit',
    mode: 'edit',
    maxImages: 10,
    sync: true,
    fields: {
      output_format: format,
      quality: choice('质量', ['low', 'medium', 'high'], 'medium'),
      size: choice(
        '画面尺寸',
        [
          '1024x1024',
          '1024x768',
          '768x1024',
          '1024x1536',
          '1536x1024',
          '2048x2048',
          '2048x1152',
          '1152x2048',
          '2560x1088',
          '1088x2560',
          '2880x2160',
          '2160x2880',
          '3840x2160',
          '2160x3840',
        ],
        '1024x1024',
      ),
    },
    docs: docs('openai/gpt-image-2-edit'),
  },
  // Qwen 文档描述与 schema 上限不一致，按机器可读 schema 的三张限制校验。
  {
    id: 'qwen-image-2',
    name: 'Qwen Image 2.0',
    model: 'qwen/qwen-image-2.0/edit',
    mode: 'edit',
    maxImages: 3,
    promptLimit: 800,
    fields: { seed, size: { type: 'string', title: '画面尺寸', pattern: '^\\d{3,4}\\*\\d{3,4}$' } },
    docs: docs('qwen/qwen-image-2.0-edit'),
  },
  {
    id: 'grok-image-2',
    name: 'Grok Imagine Image 2.0',
    model: 'xai/grok-imagine-image-2.0/edit',
    mode: 'edit',
    maxImages: 3,
    promptLimit: 8000,
    imageField: 'image_urls',
    fields: {
      aspect_ratio: choice(
        '画面比例',
        [
          'auto',
          '1:1',
          '3:4',
          '4:3',
          '9:16',
          '16:9',
          '2:3',
          '3:2',
          '9:19.5',
          '19.5:9',
          '9:20',
          '20:9',
          '1:2',
          '2:1',
        ],
        'auto',
      ),
      resolution: choice('分辨率', ['1k', '2k'], '1k'),
      quality: choice('质量', ['low', 'medium'], 'medium'),
      num_images: { type: 'integer', title: '张数', minimum: 1, maximum: 4, default: 1 },
    },
    docs: docs('xai/grok-imagine-image-2.0-edit'),
  },
]
export function atlasDefaults(model: AtlasModel) {
  return Object.fromEntries(
    Object.entries(model.fields).flatMap(([key, field]) =>
      field.default === undefined ? [] : [[key, field.default]],
    ),
  )
}

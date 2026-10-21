import { t as __t } from './i18n'
import { z } from 'zod'
import type { Assets } from './assets'
import { serviceSchema, stepSchema, type ServiceProfile } from './domain'
import type { Store } from './store'
import { validate } from './schema'
import { ServiceRequestError } from './requestSafety'
import { configureVideo, videoOptions } from './videoModels'

const credentialId = 'provider:apimodels'
const ratios = ['auto', '1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16', '4:5', '5:4', '21:9']
const choice = (title: string, values: string[], fallback: string) => ({
  type: 'string',
  title,
  enum: values,
  default: fallback,
})
// 型号、字段和参考图上限取自 APIModels 官方文档；不沿用 AtlasCloud 的模型协议。
export const apiModels = [
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    maxImages: 16,
    docs: 'gpt-image-2',
    fields: {
      aspect_ratio: choice('画面比例', ratios, '1:1'),
      resolution: choice('分辨率', ['1K', '2K', '4K'], '1K'),
      output_format: choice('输出格式', ['png', 'jpeg', 'webp'], 'png'),
    },
  },
  {
    id: 'nano-banana-2-1',
    name: 'Nano Banana 2.1',
    maxImages: 10,
    docs: 'nano-banana-2-1',
    fields: {
      aspect_ratio: choice('画面比例', [...ratios, '1:4', '4:1', '1:8', '8:1'], 'auto'),
      resolution: choice('分辨率', ['1K', '2K', '4K'], '1K'),
    },
  },
  {
    id: 'doubao-seedream-5-0-pro',
    name: 'Seedream 5.0 Pro',
    maxImages: 1,
    docs: 'doubao-seedream',
    fields: {
      aspect_ratio: choice(
        '画面比例',
        ratios.filter((value) => value !== 'auto'),
        '1:1',
      ),
      size: choice('分辨率', ['1K', '2K'], '2K'),
    },
  },
  {
    id: 'doubao-seedream-5-0-flash',
    name: 'Seedream 5.0 Flash',
    maxImages: 1,
    docs: 'doubao-seedream',
    fields: {
      aspect_ratio: choice(
        '画面比例',
        ratios.filter((value) => value !== 'auto'),
        '1:1',
      ),
      size: choice('分辨率', ['1K', '2K'], '2K'),
    },
  },
  {
    id: 'doubao-seedream-5-0-260128',
    name: 'Seedream 5.0 Lite',
    maxImages: 1,
    docs: 'doubao-seedream',
    fields: {
      aspect_ratio: choice(
        '画面比例',
        ratios.filter((value) => value !== 'auto'),
        '1:1',
      ),
      size: choice('分辨率', ['2K', '4K'], '2K'),
    },
  },
  // 4.5 文档未明确多图数量上限，首版保守提供单参考输入。
  {
    id: 'doubao-seedream-4-5-251128',
    name: 'Seedream 4.5',
    maxImages: 1,
    docs: 'doubao-seedream',
    fields: {
      aspect_ratio: choice(
        '画面比例',
        ratios.filter((value) => value !== 'auto'),
        '1:1',
      ),
      resolution: choice('分辨率', ['1k', '2k', '3k', '4k'], '2k'),
    },
  },
]
const modelId = z
  .string()
  .refine((value) => apiModels.some((model) => model.id === value), 'APIModels 模型不存在')
export function apiModelsSettings(store: Store, owner: string) {
  return {
    name: 'APIModels',
    defaultModel: 'gpt-image-2',
    defaultVideoModel: videoOptions('apimodels')[0]?.id,
    models: [
      ...apiModels.flatMap(({ id, name, maxImages }) =>
        ['generate', 'edit'].map((mode) => ({ id, name, mode, maxImages })),
      ),
      ...videoOptions('apimodels'),
    ],
    ...store.get<Record<string, unknown>>(owner, 'provider', 'apimodels'),
    hasCredential: Boolean(store.secret(owner, credentialId)),
  }
}
export function configureApiModels(store: Store, owner: string, raw: unknown) {
  const value = z
    .object({
      apiKey: z
        .string()
        .trim()
        .min(1)
        .max(8192)
        .regex(/^[^\r\n]*$/)
        .optional(),
      clearCredential: z.boolean().optional(),
      generateModel: modelId,
      editModel: modelId,
      videoModel: z
        .string()
        .refine(
          (id) => videoOptions('apimodels').some((model) => model.id === id),
          '视频模型不存在',
        )
        .optional(),
      expectedRevision: z.number().int().nonnegative().optional(),
    })
    .strict()
    .parse(raw)
  return store.transaction(() => {
    const previous = store.get<{ revision: number }>(owner, 'provider', 'apimodels')
    if ((previous?.revision ?? 0) !== (value.expectedRevision ?? 0))
      throw new Error('服务配置已变化，请刷新后重试')
    if (value.apiKey) store.secret(owner, credentialId, value.apiKey)
    else if (value.clearCredential) store.secret(owner, credentialId, null)
    for (const mode of ['generate', 'edit'] as const) {
      const family = apiModels.find(
        (model) => model.id === (mode === 'generate' ? value.generateModel : value.editModel),
      )!
      const serviceId = `apimodels.${mode}`,
        stepId = `builtin.apimodels.image-${mode}`
      const defaults = Object.fromEntries(
        Object.entries(family.fields)
          .filter(([, field]) => field)
          .map(([name, field]) => [name, field!.default]),
      )
      const service = serviceSchema.parse({
        id: serviceId,
        name: `APIModels · ${family.name}`,
        adapter: 'apimodels',
        credentialId,
        baseUrl: 'https://api.apimodels.app/v1/',
        requiresCredential: true,
        submit: {
          path: 'images/generations',
          body: { model: family.id, ...defaults },
          taskIdField: 'data.id',
          outputs: { images: { path: 'data.outputs', kind: 'image' } },
        },
        poll: {
          path: 'images/generations?task_id={id}',
          stateField: 'data.status',
          success: ['completed'],
          failed: ['failed'],
          intervalMs: 3000,
        },
        timeoutMs: 1200000,
        requestTimeoutMs: 90000,
        recoveryWindowMs: 21600000,
        concurrency: 2,
      })
      const oldService = store.get<ServiceProfile>(owner, 'service', serviceId)
      store.put(
        owner,
        'service',
        { ...service, hasCredential: Boolean(store.secret(owner, credentialId)) },
        oldService?.revision ?? 0,
      )
      const asset = {
        type: 'object',
        properties: { assetId: { type: 'string' } },
        required: ['assetId'],
        additionalProperties: false,
      }
      const step = stepSchema.parse({
        id: stepId,
        name: mode === 'edit' ? '图像编辑' : '图像生成',
        enabled: true,
        usageDescription: `${family.name}，通过 APIModels 执行。提示词使用自然语言，原样传入。${mode === 'edit' ? `按顺序提供 1～${family.maxImages} 张 PNG、JPEG 或 WebP 素材，每张不超过 10 MB；说明修改与保留内容。` : '描述要生成的画面。'}其余字段按输入 schema 填写。`,
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              title:
                mode === 'edit'
                  ? __t('apps.pictoria.ui', '编辑说明')
                  : __t('apps.pictoria.ui', '提示词'),
              minLength: 1,
              maxLength: 20000,
            },
            ...(mode === 'edit'
              ? {
                  images: {
                    type: 'array',
                    title: __t('apps.pictoria.ui', '参考图片'),
                    items: asset,
                    minItems: 1,
                    maxItems: family.maxImages,
                  },
                }
              : {}),
            ...family.fields,
          },
          required: mode === 'edit' ? ['prompt', 'images'] : ['prompt'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { images: { type: 'array', items: asset, minItems: 1 } },
          required: ['images'],
          additionalProperties: false,
        },
        implementation: { kind: 'service', serviceId },
      })
      const oldStep = store.get<{ revision: number }>(owner, 'step', stepId)
      const saved = store.put(owner, 'step', step, oldStep?.revision ?? 0)
      store.put(owner, 'step-version', { id: `${saved.id}:${saved.revision}`, snapshot: saved }, 0)
    }
    const videoModel =
      value.videoModel ||
      store.get<{ videoModel?: string }>(owner, 'provider', 'apimodels')?.videoModel ||
      videoOptions('apimodels')[0]!.id
    configureVideo(store, owner, 'apimodels', videoModel)
    store.put(
      owner,
      'provider',
      {
        id: 'apimodels',
        generateModel: value.generateModel,
        editModel: value.editModel,
        videoModel,
      },
      previous?.revision ?? 0,
    )
    return apiModelsSettings(store, owner)
  })
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
/** 统一任务字段，并保留供应商给出的具体失败原因。 */
export function normalizeApiModels(value: unknown) {
  const root = record(value),
    data = record(root.data ?? value)
  if (root.code !== undefined && ![0, 200, '200'].includes(root.code as number | string)) {
    const status = Number(root.code)
    throw new ServiceRequestError(
      `APIModels：${String(root.msg ?? root.message ?? '请求失败').slice(0, 500)}`,
      {
        status,
        definitiveRejection: status >= 400 && status < 500 && ![408, 409, 425].includes(status),
        retryable: [408, 429, 500, 502, 503, 504].includes(status),
      },
    )
  }
  const state = String(data.state ?? data.status ?? 'pending').toLowerCase()
  const raw = data.resultUrls ?? data.outputs ?? []
  const outputs = (Array.isArray(raw) ? raw : [raw]).filter(
    (item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item),
  )
  const error = data.failMsg ?? data.error ?? root.msg
  return {
    data: {
      id: data.taskId ?? data.task_id ?? data.id,
      status: ['completed', 'succeeded', 'success'].includes(state)
        ? 'completed'
        : ['failed', 'error', 'cancelled', 'canceled'].includes(state)
          ? 'failed'
          : state,
      outputs,
      error: typeof error === 'string' ? error.slice(0, 600) : undefined,
    },
  }
}
export async function submitApiModels(
  owner: string,
  service: ServiceProfile,
  inputs: Record<string, unknown>,
  assets: Assets,
  request: (body: unknown) => Promise<unknown>,
) {
  const family = apiModels.find((model) => model.id === service.submit.body.model)
  if (!family) throw new Error('当前 APIModels 型号未适配，请使用通用 HTTP 配置其 API')
  const payload: Record<string, unknown> = { ...service.submit.body, prompt: inputs.prompt }
  for (const name of Object.keys(family.fields))
    if (inputs[name] !== undefined) payload[name] = inputs[name]
  validate(
    {
      type: 'object',
      properties: { prompt: { type: 'string', minLength: 1, maxLength: 20000 }, ...family.fields },
      required: ['prompt'],
      additionalProperties: false,
    },
    Object.fromEntries(
      Object.entries(payload).filter(([name]) => name === 'prompt' || name in family.fields),
    ),
  )
  if (
    family.id === 'gpt-image-2' &&
    ['5:4', '4:5'].includes(String(payload.aspect_ratio)) &&
    payload.resolution !== '1K'
  )
    throw new Error('GPT Image 2 的 5:4／4:5 比例仅支持 1K')
  if (inputs.images !== undefined) {
    if (
      !Array.isArray(inputs.images) ||
      !inputs.images.length ||
      inputs.images.length > family.maxImages
    )
      throw new Error(`当前模型需要 1～${family.maxImages} 张参考图片`)
    const images: string[] = []
    let bytes = 0
    for (const source of inputs.images) {
      const file = await assets.file(owner, source, 10 * 1024 * 1024)
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.blob.type))
        throw new Error('APIModels 参考图接受 PNG、JPEG、WebP；GIF 请先选取静态帧')
      bytes += Math.ceil(file.blob.size / 3) * 4
      if (bytes > 95 * 1024 * 1024)
        throw new Error('参考图总大小超过请求限制，请减少图片或缩小尺寸')
      images.push(await assets.dataUrl(owner, source))
    }
    // 使用官方支持的数据 URI，避免本地地址不可达、上传 URL 过期与重试时请求指纹改变。
    if (family.maxImages > 1) payload.image_urls = images
    else payload.image_url = images[0]
  }
  return request(payload)
}

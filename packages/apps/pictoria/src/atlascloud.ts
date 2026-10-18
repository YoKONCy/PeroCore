import { z } from 'zod'
import type { Store } from './store'
import { serviceSchema, stepSchema, type ServiceProfile } from './domain'
import type { Assets } from './assets'
import { atlasDefaults, atlasModels } from './atlasModels'
import { validate } from './schema'
import { configureVideo, videoOptions } from './videoModels'

const credentialId = 'provider:atlascloud'

/** 模型能力取自 AtlasCloud 官方接口；保留智绘姬的上传、提交、轮询适配边界。 */
export function atlasSettings(store: Store, owner: string) {
  const models = atlasModels.map(({ id, name, mode, maxImages }) => ({ id, name, mode, maxImages }))
  return {
    families: models.filter((model) => model.mode === 'generate'),
    models: [...models, ...videoOptions('atlascloud')],
    defaultVideoModel: videoOptions('atlascloud')[0]?.id,
    hasCredential: Boolean(store.secret(owner, credentialId)),
    ...store.get<Record<string, unknown>>(owner, 'provider', 'atlascloud'),
  }
}
export function configureAtlas(store: Store, owner: string, raw: unknown) {
  const value = z
    .object({
      apiKey: z.string().trim().min(1).max(8192).optional(),
      clearCredential: z.boolean().optional(),
      generateModel: z
        .string()
        .refine(
          (id) => atlasModels.some((model) => model.id === id && model.mode === 'generate'),
          '生成模型不存在',
        ),
      editModel: z
        .string()
        .refine(
          (id) => atlasModels.some((model) => model.id === id && model.mode === 'edit'),
          '编辑模型不存在',
        ),
      expectedRevision: z.number().int().nonnegative().optional(),
      videoModel: z
        .string()
        .refine(
          (id) => videoOptions('atlascloud').some((model) => model.id === id),
          '视频模型不存在',
        )
        .optional(),
    })
    .strict()
    .parse(raw)
  return store.transaction(() => {
    const previous = store.get<{ id: string; revision: number }>(owner, 'provider', 'atlascloud')
    if ((previous?.revision ?? 0) !== (value.expectedRevision ?? 0))
      throw new Error('服务配置已变化，请刷新后重试')
    if (value.apiKey) store.secret(owner, credentialId, value.apiKey)
    else if (value.clearCredential) store.secret(owner, credentialId, null)
    for (const mode of ['generate', 'edit'] as const) {
      const family = atlasModels.find(
        (item) =>
          item.mode === mode &&
          item.id === (mode === 'generate' ? value.generateModel : value.editModel),
      )!
      const serviceId = `atlascloud.${mode}`,
        stepId = `builtin.image-${mode}`
      const service = serviceSchema.parse({
        id: serviceId,
        name: `AtlasCloud · ${family.name}`,
        adapter: 'atlascloud',
        credentialId,
        baseUrl: 'https://api.atlascloud.ai',
        requiresCredential: true,
        submit: {
          path: '/api/v1/model/generateImage',
          method: 'POST',
          body: { model: family.model, ...atlasDefaults(family) },
          taskIdField: 'data.id',
          outputs: { images: { path: 'data.outputs', kind: 'image' } },
        },
        poll: {
          path: '/api/v1/model/prediction/{id}',
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
      const properties: Record<string, unknown> = {
        prompt: {
          type: 'string',
          title: mode === 'edit' ? '编辑说明' : '提示词',
          minLength: 1,
          maxLength: family.promptLimit || 32000,
          description:
            mode === 'edit'
              ? '说明希望修改什么，以及哪些内容需要保留。'
              : '用自然语言描述主体、场景、风格与构图。',
        },
        ...(mode === 'edit'
          ? {
              images: {
                type: 'array',
                title: '参考图片',
                items: asset,
                minItems: 1,
                maxItems: family.maxImages,
              },
            }
          : {}),
        ...family.fields,
      }
      const step = stepSchema.parse({
        id: stepId,
        name: mode === 'generate' ? '图像生成' : '图像编辑',
        enabled: true,
        usageDescription: `${family.name}，通过 AtlasCloud 执行。${mode === 'edit' ? `按顺序提供 1～${family.maxImages} 张 PNG、JPEG、WebP${family.gif ? ' 或 GIF' : ''} 参考图片，用自然语言说明修改与保留的内容。` : '使用自然语言描述要生成的画面。'}${family.id === 'grok-image-2' ? '多图按 <IMAGE_0>、<IMAGE_1>、<IMAGE_2> 引用。' : ''}提示词原样传入；具体参数按输入 schema 填写。`,
        inputSchema: {
          type: 'object',
          properties,
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
      store.get<{ videoModel?: string }>(owner, 'provider', 'atlascloud')?.videoModel ||
      videoOptions('atlascloud')[0]!.id
    configureVideo(store, owner, 'atlascloud', videoModel)
    store.put(
      owner,
      'provider',
      {
        id: 'atlascloud',
        generateModel: value.generateModel,
        editModel: value.editModel,
        videoModel,
      },
      previous?.revision ?? 0,
    )
    return atlasSettings(store, owner)
  })
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
/** 上传接口返回 download_url；兼容旧版 url 字段及不同响应包裹层。 */
export function atlasUploadUrl(value: unknown): string | undefined {
  const root = record(value),
    data = record(root.data),
    result = record(root.result)
  const containers = [value, root.data, root.result, data.file, result.file, root.file]
  for (const container of containers) {
    const entry = record(container)
    const candidates =
      typeof container === 'string'
        ? [container]
        : [
            entry.download_url,
            entry.downloadUrl,
            entry.url,
            entry.media_url,
            entry.file_url,
            entry.fileUrl,
          ]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      try {
        const url = new URL(candidate.trim())
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
          return url.href
      } catch {
        /* 跳过无效字段，继续读取其他兼容地址。 */
      }
    }
  }
  return undefined
}
export function normalizeAtlas(value: unknown) {
  const root = record(value),
    data = record(root.data ?? value)
  const state = String(data.status || '').toLowerCase()
  const raw = data.outputs ?? data.output ?? data.images ?? data.image_url
  const outputs = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((item) => {
    const entry =
      typeof item === 'string'
        ? item
        : (record(item).url ?? record(item).image_url ?? record(item).b64_json)
    if (typeof entry !== 'string') return []
    if (/^https?:\/\//i.test(entry) || /^data:image\//i.test(entry)) return [entry]
    if (entry.length > 256 && /^[\w+/=\s]+$/.test(entry)) {
      const base64 = entry.replace(/\s/g, ''),
        mime = base64.startsWith('/9j/')
          ? 'image/jpeg'
          : base64.startsWith('UklGR')
            ? 'image/webp'
            : base64.startsWith('R0lG')
              ? 'image/gif'
              : 'image/png'
      return [`data:${mime};base64,${base64}`]
    }
    return []
  })
  const error = data.error ?? data.message ?? root.message
  return {
    data: {
      id: data.id ?? data.predictionId ?? root.predictionId,
      status: ['completed', 'succeeded', 'success'].includes(state)
        ? 'completed'
        : ['failed', 'error', 'canceled', 'cancelled'].includes(state)
          ? 'failed'
          : state || 'processing',
      outputs,
      error:
        typeof error === 'string'
          ? error.slice(0, 600)
          : typeof record(error).message === 'string'
            ? String(record(error).message).slice(0, 600)
            : undefined,
    },
  }
}
type Request = (
  requestPath: string,
  method: string,
  body: unknown,
  beforeSend?: () => void,
  uploadKey?: string,
) => Promise<unknown>
export async function submitAtlas(
  owner: string,
  service: ServiceProfile,
  inputs: Record<string, unknown>,
  assets: Assets,
  request: Request,
  beforeSend?: () => void,
) {
  const model = String(service.submit.body.model)
  const family = atlasModels.find((item) => item.model === model)
  if (!family) throw new Error('当前 AtlasCloud 型号未适配，请使用通用 HTTP 配置其 API')
  const edit = family.mode === 'edit'
  const payload: Record<string, unknown> = {
    model,
    prompt: inputs.prompt,
    enable_base64_output: false,
    ...(family.sync ? { enable_sync_mode: false } : {}),
  }
  for (const key of Object.keys(family.fields))
    if (inputs[key] !== undefined || service.submit.body[key] !== undefined)
      payload[key] = inputs[key] ?? service.submit.body[key]
  validate(
    {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: family.promptLimit || 32000 },
        ...family.fields,
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    Object.fromEntries(
      Object.entries(payload).filter(([key]) => key === 'prompt' || key in family.fields),
    ),
  )
  if (payload.size && (family.id.startsWith('flux-') || family.id === 'qwen-image-2')) {
    const dimensions = String(payload.size).split('*').map(Number),
      minimum = family.id.startsWith('flux-') ? 256 : 512
    if (
      dimensions.length !== 2 ||
      dimensions.some((value) => !Number.isInteger(value) || value < minimum || value > 2048)
    )
      throw new Error(`画面尺寸须为 ${minimum}～2048 像素`)
  }
  if (edit) {
    if (
      !Array.isArray(inputs.images) ||
      !inputs.images.length ||
      inputs.images.length > family.maxImages
    )
      throw new Error(`当前模型需要 1～${family.maxImages} 张参考图片`)
    const references: string[] = []
    for (let index = 0; index < inputs.images.length; index++) {
      const source = inputs.images[index]
      const file = await assets.file(owner, source, 20 * 1024 * 1024)
      if (
        !['image/png', 'image/jpeg', 'image/webp', ...(family.gif ? ['image/gif'] : [])].includes(
          file.blob.type,
        )
      )
        throw new Error(
          `当前编辑模型接受 PNG、JPEG、WebP${family.gif ? '、GIF' : '；GIF 请先选取静态帧'}`,
        )
      if (file.blob.size > 20 * 1024 * 1024) throw new Error('参考图片不能超过 20 MB')
      const form = new FormData()
      form.append('file', file.blob, file.name)
      const response = await request(
        '/api/v1/model/uploadMedia',
        'POST',
        form,
        undefined,
        `${index}:${String(source.assetId)}`,
      )
      const url = atlasUploadUrl(response)
      if (!url) throw new Error('图片上传响应缺少下载地址，尚未提交生成任务；请重试上传')
      references.push(url)
    }
    payload[family.imageField || 'images'] = references
  }
  return request(service.submit.path, 'POST', payload, beforeSend)
}

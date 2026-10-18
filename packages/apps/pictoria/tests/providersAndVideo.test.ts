import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PictoriaApplication } from '../src/application'
import { Store } from '../src/store'
import { ServiceClient } from '../src/serviceClient'
import { configureApiModels } from '../src/apimodels'
import { configureAtlas } from '../src/atlascloud'
import { assertCredentialScope, saveProvider } from '../src/providers'
import type { ServiceProfile } from '../src/domain'
const owner = 'test-owner',
  scope = { owner, callId: 'test-call' }
const fixtures: Array<{ store: Store; app: PictoriaApplication }> = []
function fixture() {
  const store = new Store(
      mkdtempSync(path.join(tmpdir(), 'pictoria-providers-')),
      fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
    ),
    app = new PictoriaApplication(store)
  fixtures.push({ store, app })
  return { store, app }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const { store, app } of fixtures.splice(0)) {
    await app.execution.stop()
    store.close()
    if (path.dirname(path.resolve(store.root)) !== path.resolve(tmpdir()))
      throw new Error('临时目录越界')
    rmSync(store.root, { recursive: true, force: true })
  }
})
describe('供应商凭据与视频步骤', () => {
  it('相同域名更换适配器不能沿用另一供应商 Key', () => {
    const { store } = fixture()
    expect(() =>
      assertCredentialScope(store, owner, {
        id: 'copy',
        credentialId: 'provider:atlascloud',
        adapter: 'apimodels',
        baseUrl: 'https://api.atlascloud.ai',
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
      }),
    ).toThrow('供应商不匹配')
  })
  it('显式新 Key 覆盖旧别名，并阻止变更域名后继续沿用', async () => {
    const { app, store } = fixture()
    const definition = {
      id: 'private-service',
      name: '私有 API',
      baseUrl: 'https://first.invalid',
      credentialId: 'provider:atlascloud',
      credential: 'private-test-key',
      requiresCredential: true,
      submit: { path: '/generate' },
    }
    const service = (await app.invoke(
      'service.save',
      { definition, expectedRevision: 0 },
      scope,
    )) as ServiceProfile
    expect(service.credentialId).toBe(service.id)
    expect(store.secret(owner, service.id)).toBe('private-test-key')
    await expect(
      app.invoke(
        'service.save',
        {
          definition: {
            ...definition,
            credential: undefined,
            credentialId: service.id,
            baseUrl: 'https://second.invalid',
          },
          expectedRevision: service.revision,
        },
        scope,
      ),
    ).rejects.toThrow('重新填写')
    expect(store.get<ServiceProfile>(owner, 'service', service.id)?.baseUrl).toBe(
      'https://first.invalid',
    )
  })
  it('通用供应商改地址时不能静默保留旧凭据', () => {
    const { store } = fixture()
    const profile = saveProvider(
      store,
      owner,
      {
        id: 'custom',
        name: '自定义',
        baseUrl: 'https://first.invalid/v1',
        credential: 'custom-test-key',
      },
      0,
    )
    expect(() =>
      saveProvider(
        store,
        owner,
        { id: 'custom', name: '自定义', baseUrl: 'https://second.invalid/v1' },
        profile.revision,
      ),
    ).toThrow('重新填写')
  })
  it('模型目录区分供应商，视频步骤参考图可空且返回视频', () => {
    const { store, app } = fixture()
    configureAtlas(store, owner, {
      apiKey: 'atlas-test-key',
      generateModel: 'nano-banana-pro',
      editModel: 'nano-banana-pro',
    })
    configureApiModels(store, owner, {
      apiKey: 'api-models-test-key',
      generateModel: 'gpt-image-2',
      editModel: 'gpt-image-2',
      videoModel: 'veo-3.1',
    })
    const catalog = app.catalog(owner),
      video = catalog.find((step) => step.id === 'builtin.apimodels.video-generate')!
    expect(video.providerName).toBe('APIModels')
    expect(video.inputSchema.required).toEqual(['prompt'])
    expect(video.outputSchema.properties).toHaveProperty('videos')
    expect(
      catalog.find((step) => step.id === 'builtin.atlascloud.video-generate')?.providerName,
    ).toBe('AtlasCloud')
  })
  it('视频参考图经签名上传，不把平台 Key 发给 R2；重入不重复提交', async () => {
    const { store, app } = fixture()
    configureApiModels(store, owner, {
      apiKey: 'api-models-test-key',
      generateModel: 'gpt-image-2',
      editModel: 'gpt-image-2',
      videoModel: 'veo-3.1',
    })
    const asset = await app.assets.save(owner, '参考.png', 'image/png', Buffer.from('参考图片'))
    const fetchMock = vi.fn(async (url: URL | string) =>
      String(url).endsWith('/files')
        ? Response.json({
            code: 200,
            data: {
              uploadUrl:
                'https://account.r2.cloudflarestorage.com/uploads/reference.png?signature=test',
              publicUrl: 'https://r2.apimodels.app/uploads/reference.png',
            },
          })
        : String(url).includes('cloudflarestorage')
          ? new Response(null, { status: 200 })
          : Response.json({ code: 200, data: { taskId: 'video-1', state: 'pending' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const service = store.get<ServiceProfile>(owner, 'service', 'apimodels.video')!,
      client = new ServiceClient(store, app.assets),
      inputs = { prompt: '缓慢推镜', images: [{ assetId: asset.id }] },
      signal = new AbortController().signal
    await client.submit(owner, service, inputs, signal, 'video-request')
    await new ServiceClient(store, app.assets).submit(
      owner,
      service,
      inputs,
      signal,
      'video-request',
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const calls = fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>
    expect(new Headers(calls[1]![1].headers).has('Authorization')).toBe(false)
    expect(String(calls[2]![0])).toBe('https://api.apimodels.app/v1/video/generations')
    expect(JSON.parse(String(calls[2]![1].body)).images).toEqual([
      'https://r2.apimodels.app/uploads/reference.png',
    ])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from '../src/store'
import { Assets } from '../src/assets'
import { ServiceClient } from '../src/serviceClient'
import { configureApiModels, normalizeApiModels } from '../src/apimodels'
import type { ServiceProfile } from '../src/domain'

const fixtures: Store[] = []
const owner = 'test-owner'
function fixture() {
  const store = new Store(
    mkdtempSync(path.join(tmpdir(), 'pictoria-apimodels-')),
    fileURLToPath(new URL('../src/database/migrations', import.meta.url)),
  )
  fixtures.push(store)
  configureApiModels(store, owner, {
    apiKey: 'apimodels-test-key',
    generateModel: 'gpt-image-2',
    editModel: 'nano-banana-2-1',
  })
  const assets = new Assets(store),
    client = new ServiceClient(store, assets)
  return {
    store,
    assets,
    client,
    service: store.get<ServiceProfile>(owner, 'service', 'apimodels.edit')!,
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  for (const store of fixtures.splice(0)) {
    store.close()
    if (path.dirname(path.resolve(store.root)) !== path.resolve(tmpdir()))
      throw new Error('临时目录越界')
    rmSync(store.root, { recursive: true, force: true })
  }
})
describe('APIModels 接入', () => {
  it('多参考图使用本地数据且复用已落盘提交回执，不重复生成', async () => {
    const { store, assets, client, service } = fixture()
    const first = await assets.save(owner, '第一张.png', 'image/png', Buffer.from('第一张素材'))
    const second = await assets.save(owner, '第二张.webp', 'image/webp', Buffer.from('第二张素材'))
    const fetchMock = vi.fn(async () =>
      Response.json({ code: 200, data: { taskId: 'remote-1', state: 'pending' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const inputs = {
      prompt: '合并两张参考图',
      images: [{ assetId: first.id }, { assetId: second.id }],
    }
    await client.submit(owner, service, inputs, new AbortController().signal, '提交一')
    const restarted = new ServiceClient(store, assets)
    await restarted.submit(owner, service, inputs, new AbortController().signal, '提交一')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.apimodels.app/v1/images/generations')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer apimodels-test-key')
    expect(JSON.parse(String(options.body)).image_urls).toEqual([
      `data:image/png;base64,${Buffer.from('第一张素材').toString('base64')}`,
      `data:image/webp;base64,${Buffer.from('第二张素材').toString('base64')}`,
    ])
    expect(restarted.submission(owner, '提交一')?.response).toMatchObject({
      data: { id: 'remote-1' },
    })
  })
  it('提交响应丢失时阻止自动重放生成请求', async () => {
    const { client, service } = fixture()
    const fetchMock = vi.fn(async () => {
      throw new TypeError('连接中断')
    })
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    await expect(
      client.submit(owner, service, { prompt: '一只猫' }, signal, '不确定提交'),
    ).rejects.toThrow()
    await expect(
      client.submit(owner, service, { prompt: '一只猫' }, signal, '不确定提交'),
    ).rejects.toMatchObject({ ambiguousSubmission: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('配置冲突不覆盖密钥，且不会替换 AtlasCloud 步骤', () => {
    const { store } = fixture()
    store.secret(owner, 'provider:atlascloud', 'AtlasCloud 测试密钥')
    expect(() =>
      configureApiModels(store, owner, {
        apiKey: '冲突密钥',
        generateModel: 'gpt-image-2',
        editModel: 'gpt-image-2',
        expectedRevision: 0,
      }),
    ).toThrow('服务配置已变化')
    expect(store.secret(owner, 'provider:apimodels')).toBe('apimodels-test-key')
    expect(store.secret(owner, 'provider:atlascloud')).toBe('AtlasCloud 测试密钥')
    expect(store.get(owner, 'step', 'builtin.image-edit')).toBeUndefined()
    expect(store.get(owner, 'step', 'builtin.apimodels.image-edit')).toBeDefined()
  })
  it('保留供应商失败原因并识别业务层拒绝', () => {
    expect(
      normalizeApiModels({ code: 200, data: { state: 'failed', failMsg: '参考图不合法' } }),
    ).toMatchObject({ data: { status: 'failed', error: '参考图不合法' } })
    expect(() => normalizeApiModels({ code: 402, msg: '余额不足' })).toThrow('余额不足')
    expect(
      normalizeApiModels({
        code: 200,
        data: { state: 'completed', resultUrls: ['https://r2.apimodels.app/作品.png'] },
      }).data.outputs,
    ).toHaveLength(1)
  })
  it('模型字段错误在发送前拦截', async () => {
    const { store, client } = fixture()
    const service = store.get<ServiceProfile>(owner, 'service', 'apimodels.generate')!
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      client.submit(
        owner,
        service,
        { prompt: '一只猫', aspect_ratio: '5:4', resolution: '4K' },
        new AbortController().signal,
        '非法比例',
      ),
    ).rejects.toThrow('仅支持 1K')
    await expect(
      client.submit(
        owner,
        service,
        { prompt: '一只猫', resolution: '8K' },
        new AbortController().signal,
        '非法分辨率',
      ),
    ).rejects.toThrow('字段校验失败')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

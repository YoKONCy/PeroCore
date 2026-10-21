import { describe, expect, it, vi } from 'vitest'
import { ModelService } from '../../../../src/services/model/modelService'

function fixture() {
  const values = new Map<string, string>()
  const models = new Map([1, 2, 3].map((id) => [id, { id, name: `模型 ${id}` }]))
  const modelRepo = {
    findById: async (id: number) => models.get(id),
    deleteById: async (id: number) => {
      models.delete(id)
    },
  }
  const configRepo = {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: string) => {
      values.set(key, value)
    },
    delete: async (key: string) => {
      values.delete(key)
    },
    listAll: async (prefix: string) =>
      [...values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
  }
  const registry = { invalidateCache: vi.fn() }
  const create = () =>
    new ModelService(modelRepo as never, {} as never, registry as never, configRepo as never)
  return { create, values, registry }
}

describe('模型回退配置持久化', () => {
  it('按卡片保存顺序，重新创建服务仍可读取，移除全部恢复空链', async () => {
    const f = fixture()
    await f.create().setFallbacks(1, [3, 2])
    expect(f.values.get('model.fallbacks.1')).toBe('[3,2]')
    expect(await f.create().getFallbacks(1)).toEqual({ modelIds: [3, 2] })
    await f.create().setFallbacks(1, [])
    expect(await f.create().getFallbacks(1)).toEqual({ modelIds: [] })
    expect(f.registry.invalidateCache).toHaveBeenCalledTimes(2)
  })

  it('拒绝自身、重复、缺失和非法卡片，失败不覆盖已保存配置', async () => {
    const f = fixture()
    const service = f.create()
    await service.setFallbacks(1, [2])
    for (const ids of [
      [1],
      [2, 2],
      [999],
      [0],
      [2.5],
      Array.from({ length: 33 }, (_, index) => index + 2),
    ])
      await expect(service.setFallbacks(1, ids)).rejects.toBeInstanceOf(Error)
    expect(await service.getFallbacks(1)).toEqual({ modelIds: [2] })
  })

  it('删除卡片时清除自己的链与其他链中的引用，不改变剩余顺序', async () => {
    const f = fixture()
    const service = f.create()
    await service.setFallbacks(1, [2, 3])
    await service.setFallbacks(2, [1, 3])
    await service.delete(2)
    expect(f.values.has('model.fallbacks.2')).toBe(false)
    expect(await service.getFallbacks(1)).toEqual({ modelIds: [3] })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openApplicationTool,
  setApplicationProvider,
  type ApplicationProvider,
} from '@infos/backend/tools/systemInfo'

describe('open_application工具', () => {
  afterEach(() => setApplicationProvider(null))

  it('应把应用名称委托给客户端能力', async () => {
    const provider: ApplicationProvider = {
      launch: vi.fn().mockResolvedValue({
        application: 'Microsoft Edge',
        mode: 'launched',
        targetType: 'aumid',
      }),
    }
    setApplicationProvider(provider)

    const result = JSON.parse(await openApplicationTool.execute({ app_name: 'Microsoft Edge' }))

    expect(result.success).toBe(true)
    expect(result.mode).toBe('launched')
    expect(provider.launch).toHaveBeenCalledWith('Microsoft Edge')
  })

  it('客户端离线时应返回结构化能力错误', async () => {
    const result = JSON.parse(await openApplicationTool.execute({ app_name: 'Edge' }))
    expect(result.error.code).toBe('APPLICATION_LAUNCH_UNAVAILABLE')
  })

  it('应保留客户端的歧义候选错误', async () => {
    setApplicationProvider({
      launch: vi
        .fn()
        .mockRejectedValue(
          new Error('APPLICATION_AMBIGUOUS: 找到多个候选：Microsoft Edge、Microsoft Store'),
        ),
    })

    const result = JSON.parse(await openApplicationTool.execute({ app_name: 'Microsoft' }))

    expect(result.error).toEqual({
      code: 'APPLICATION_AMBIGUOUS',
      message: '找到多个候选：Microsoft Edge、Microsoft Store',
    })
  })

  it('空名称应在调用客户端前拒绝', async () => {
    const provider: ApplicationProvider = {
      launch: vi.fn(),
    }
    setApplicationProvider(provider)

    const result = JSON.parse(await openApplicationTool.execute({ app_name: '  ' }))

    expect(result.error.code).toBe('APPLICATION_NAME_REQUIRED')
    expect(provider.launch).not.toHaveBeenCalled()
  })
})

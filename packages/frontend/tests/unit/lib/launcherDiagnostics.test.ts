import { describe, expect, it } from 'vitest'
import {
  cleanLaunchDiagnostic,
  createLaunchDiagnostic,
} from '@infos/frontend/lib/launcherDiagnostics'

describe('启动诊断展示边界', () => {
  it('去掉终端样式、标题控制符和不可见字符，保留可复制纯文本', () => {
    const text = '\u001b]0;终端标题\u0007\u001b[31mEACCES\u001b[0m\r\n文件占用\u0000'
    expect(cleanLaunchDiagnostic(text)).toBe('EACCES\n文件占用')
  })

  it('超长错误、日志和路径分别限长，无效 IPC 字段不直接转成界面文本', () => {
    const diagnostic = createLaunchDiagnostic(
      'backend',
      new Error('错误'.repeat(15_000)),
      '日志'.repeat(15_000),
      '路径'.repeat(2000),
    )
    expect(diagnostic.error.length).toBeLessThanOrEqual(2000)
    expect(diagnostic.logTail.length).toBeLessThanOrEqual(12_000)
    expect(diagnostic.logPath.length).toBeLessThanOrEqual(1000)
    expect(createLaunchDiagnostic('backend', { message: '无效对象' }).error).toBe('')
  })
})

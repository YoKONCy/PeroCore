import { describe, expect, it } from 'vitest'
import { selectInheritedEnvironment } from '@infos/backend/services/execution/sandboxRunner'
import { createDefaultSandboxProfile } from '@infos/backend/services/execution/executionSession'

describe('执行进程环境白名单', () => {
  it('Windows Worker 的大小写敏感副本仍保留系统路径，且不传递重复 PATH', () => {
    expect(
      selectInheritedEnvironment(
        ['Path', 'PATH', 'SystemRoot', 'USERPROFILE'],
        {
          PATH: '系统路径',
          SYSTEMROOT: '系统目录',
          UserProfile: '用户目录',
          API_KEY: '不能继承',
        },
        'win32',
      ),
    ).toEqual({ Path: '系统路径', SystemRoot: '系统目录', USERPROFILE: '用户目录' })
  })

  it('默认策略保留 PowerShell 模块发现与缓存目录，不隐式继承凭据', () => {
    const profile = createDefaultSandboxProfile('workspace-write', '/workspace')
    const env = selectInheritedEnvironment(
      profile.inheritEnv,
      {
        APPDATA: '应用配置',
        LOCALAPPDATA: '本地缓存',
        PROGRAMFILES: '程序目录',
        PSMODULEPATH: '系统模块',
        COMSPEC: '系统命令解释器',
        GITHUB_TOKEN: '不能继承',
      },
      'win32',
    )
    expect(env).toMatchObject({
      APPDATA: '应用配置',
      LOCALAPPDATA: '本地缓存',
      ProgramFiles: '程序目录',
      PSModulePath: '系统模块',
      ComSpec: '系统命令解释器',
    })
    expect(env).not.toHaveProperty('GITHUB_TOKEN')
  })

  it('Unix 环境仍区分大小写，并继续服从自定义最小白名单', () => {
    expect(
      selectInheritedEnvironment(
        ['PATH'],
        { PATH: '系统路径', Path: '其他路径', APPDATA: '未授权目录' },
        'linux',
      ),
    ).toEqual({ PATH: '系统路径' })
    expect(
      selectInheritedEnvironment(['PATH'], { PATH: '系统路径', APPDATA: '未授权目录' }, 'win32'),
    ).toEqual({ PATH: '系统路径' })
  })
})

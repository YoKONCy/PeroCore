import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { electronProcessEnvironment } from '../src/electronEnvironment'

const require = createRequire(import.meta.url)
const scripts = require('../../../scripts/electron-environment.cjs') as {
  electronProcessEnvironment: typeof electronProcessEnvironment
}

describe.each([
  ['共享运行时', electronProcessEnvironment],
  ['启动与打包脚本', scripts.electronProcessEnvironment],
] as const)('Electron 环境边界：%s', (_name, clean) => {
  it('应用启动移除 Node 控制项及 Windows 大小写别名，不修改父环境和证书配置', () => {
    const environment = Object.freeze({
      NODE_OPTIONS: '--no-warnings=DEP0040',
      Node_Options: '--require custom-loader.cjs',
      ELECTRON_RUN_AS_NODE: '1',
      Electron_Run_As_Node: '1',
      NODE_EXTRA_CA_CERTS: 'C:/certs/company.pem',
      PATH: 'C:/runtime',
      PERO_DATA_DIR: 'C:/data',
    })
    expect(clean(environment)).toEqual({
      NODE_EXTRA_CA_CERTS: 'C:/certs/company.pem',
      PATH: 'C:/runtime',
      PERO_DATA_DIR: 'C:/data',
    })
    expect(environment.NODE_OPTIONS).toBe('--no-warnings=DEP0040')
    expect(environment.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('内置 Daemon 与子应用仅显式保留 Node 运行模式，并传递业务路径', () => {
    expect(
      clean(
        {
          node_options: '--inspect',
          electron_run_as_node: '0',
          INFOS_ARCA_DATA_PATH: 'C:/data/arca',
          INFOS_RESOURCES_ROOT: 'C:/app/resources',
        },
        'node',
      ),
    ).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      INFOS_ARCA_DATA_PATH: 'C:/data/arca',
      INFOS_RESOURCES_ROOT: 'C:/app/resources',
    })
  })
})

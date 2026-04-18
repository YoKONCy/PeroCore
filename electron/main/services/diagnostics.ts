import path from 'path'
import fs from 'fs-extra'
import { execSync, spawnSync } from 'child_process'
import which from 'which'
import { checkNapCatInstalled } from './napcat.js'
import { checkRemoteBackendConnection, getBackendConnectionConfig } from './system.js'
import { isDev, paths, isElectron } from '../utils/env'
import { logger } from '../utils/logger'

export interface DiagnosticReport {
  python_exists: boolean
  python_path: string
  python_version: string
  script_exists: boolean
  script_path: string
  port_9120_free: boolean
  data_dir_writable: boolean
  data_dir: string
  core_available: boolean
  vc_redist_installed: boolean
  napcat_installed: boolean
  webview2_installed: boolean // 兼容性保留字段
  node_exists: boolean
  node_path: string
  node_version: string
  // 新增模型字段
  embedding_model_exists: boolean
  reranker_model_exists: boolean
  whisper_model_exists: boolean
  errors: string[]
}

const workspaceRoot = isDev
  ? path.resolve(__dirname, '../../..') // dist-electron/main -> electron -> 根目录
  : isElectron
    ? paths.resources // 生产环境: 资源 (python/, backend/) 位于 resources/ 下，而非 exe 同级目录
    : paths.app

// 规范化路径
function fixPath(p: string): string {
  return path.normalize(p)
}

function getResourceDir(): string {
  return isDev ? workspaceRoot : paths.resources
}

export async function getDiagnostics(): Promise<DiagnosticReport> {
  const errors: string[] = []
  const resourceDir = getResourceDir()
  const connectionConfig = getBackendConnectionConfig()

  logger.info('Main', `[诊断] 工作区: ${workspaceRoot}`)
  logger.info('Main', `[诊断] 资源目录: ${resourceDir}`)

  if (connectionConfig.mode === 'remote') {
    const remoteCheck = await checkRemoteBackendConnection(connectionConfig.baseUrl)

    if (!remoteCheck.ok) {
      errors.push(`远程后端不可用: ${remoteCheck.message}`)
    }

    return {
      python_exists: remoteCheck.ok,
      python_path: connectionConfig.baseUrl,
      python_version: remoteCheck.ok ? 'Remote Backend' : 'Unavailable',
      script_exists: remoteCheck.ok,
      script_path: connectionConfig.baseUrl,
      port_9120_free: true,
      data_dir_writable: remoteCheck.ok,
      data_dir: connectionConfig.baseUrl || '未配置远程后端地址',
      core_available: remoteCheck.ok,
      vc_redist_installed: remoteCheck.ok,
      napcat_installed: true,
      webview2_installed: true,
      node_exists: true,
      node_path: connectionConfig.baseUrl,
      node_version: remoteCheck.ok ? 'Remote Backend' : 'Unavailable',
      embedding_model_exists: remoteCheck.ok,
      reranker_model_exists: remoteCheck.ok,
      whisper_model_exists: remoteCheck.ok,
      errors
    }
  }

  // 1. Python 路径
  let pythonPath = ''
  let pythonExists = false
  let devVenvPythonExists = false

  // 检查开发环境虚拟环境
  const devVenvPython = path.join(workspaceRoot, 'backend/venv/Scripts/python.exe')
  const dotVenvPython = path.join(workspaceRoot, 'backend/.venv/Scripts/python.exe')

  logger.info('Main', `[诊断] 检查虚拟环境路径: ${devVenvPython} 和 ${dotVenvPython}`)

  if (await fs.pathExists(devVenvPython)) {
    devVenvPythonExists = true
    pythonPath = devVenvPython
    pythonExists = true
  } else if (await fs.pathExists(dotVenvPython)) {
    devVenvPythonExists = true
    pythonPath = dotVenvPython
    pythonExists = true
  } else {
    // 检查发布资源（多个位置）
    const trials = [
      path.join(resourceDir, 'python/python.exe'),
      path.join(resourceDir, '_up_/python/python.exe')
    ]

    for (const trial of trials) {
      if (await fs.pathExists(trial)) {
        pythonPath = trial
        pythonExists = true
        break
      }
    }
  }

  // 后备方案: 系统 Python
  if (!pythonExists) {
    try {
      const systemPython = await which('python')
      if (systemPython) {
        pythonPath = systemPython
        pythonExists = true
      }
    } catch {
      try {
        const systemPython3 = await which('python3')
        if (systemPython3) {
          pythonPath = systemPython3
          pythonExists = true
        }
      } catch {
        // 忽略
      }
    }
  }

  pythonPath = fixPath(pythonPath)

  // 检查 Python 版本和核心
  let pythonVersion = 'Unknown'
  let coreAvailable = false

  if (pythonExists) {
    logger.info('Main', `[诊断] Python 发现于: ${pythonPath}`)
    try {
      const versionOutput = execSync(`"${pythonPath}" --version`, {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim()
      pythonVersion = versionOutput
      logger.info('Main', `[诊断] Python 版本: ${pythonVersion}`)
    } catch (e: any) {
      logger.error('Main', `[诊断] Python 版本检查失败: ${e.message}`)
      errors.push('Python 解释器无法运行，可能缺少系统组件 (如 VCRUNTIME140.dll)')
    }

    try {
      // [修复] 为诊断检测构建隔离的 Python 环境，防止在 Portable 模式下命中系统 Python 环境导致误报
      const coreEnv: Record<string, string | undefined> = { ...process.env }
      delete coreEnv.PYTHONHOME
      delete coreEnv.PYTHONPATH
      coreEnv.PYTHONNOUSERSITE = '1'

      // 如果检测到是便携路径，手动对齐 PYTHONPATH 以指向资源包内的 site-packages
      if (pythonPath.includes('resources')) {
        coreEnv.PYTHONPATH = path.join(path.dirname(pythonPath), 'Lib', 'site-packages')
      }

      const coreCheckResult = spawnSync(pythonPath, ['-c', "import triviumdb; print('OK')"], {
        encoding: 'utf8',
        env: coreEnv
      })

      const coreCheck = (coreCheckResult.stdout || '').toString().trim()
      if (coreCheck.includes('OK')) {
        coreAvailable = true
      } else {
        logger.warn('Main', `[诊断] triviumdb 导入失败 (隔离模式): 输出为 [${coreCheck}]`)
      }
    } catch (e: any) {
      logger.warn('Main', `[诊断] triviumdb 检查异常: ${e.message}`)
    }
  } else {
    logger.error('Main', `[诊断] 未找到 Python。`)
    errors.push(`Python 解释器未找到。探测路径: ${pythonPath}`)
  }

  // 2. 脚本路径
  let scriptPath = ''
  const scriptTrials = [
    path.join(workspaceRoot, 'backend/main.py'),
    path.join(resourceDir, 'backend/main.py'),
    path.join(resourceDir, 'main.py'),
    path.join(resourceDir, '_up_/backend/main.py'),
    path.join(process.resourcesPath, 'backend/main.py') // 为打包后的应用添加明确的 resourcesPath 检查
  ]

  for (const trial of scriptTrials) {
    if (await fs.pathExists(trial)) {
      scriptPath = trial
      break
    }
  }
  scriptPath = fixPath(scriptPath)
  const scriptExists = await fs.pathExists(scriptPath)
  if (!scriptExists) {
    errors.push(`后端主脚本未找到: ${scriptPath}`)
  }

  // 3. 检查端口 9120
  // 在 Node 中，我们可以尝试启动服务器或使用 net.connect。
  // 简单检查：尝试连接，如果成功则端口被占用。
  const port9120Free = await checkPortFree(9120)
  if (!port9120Free) {
    errors.push('端口 9120 已被占用，请检查是否有其他 PeroCore 实例在运行')
  }

  // 4. 数据目录（paths.data 已根据环境自动选择正确路径）
  const dataDir = fixPath(paths.data)
  logger.info('Main', `[诊断] 数据目录: ${dataDir}`)
  await fs.ensureDir(dataDir)

  let dataDirWritable = false
  try {
    const testFile = path.join(dataDir, '.write_test')
    await fs.writeFile(testFile, '')
    await fs.remove(testFile)
    dataDirWritable = true
  } catch {
    errors.push(`数据目录不可写: ${dataDir}`)
  }

  // 5. VC++ Redist (仅限 Windows)
  let vcRedistInstalled = true
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows'
    const vcRuntime = path.join(systemRoot, 'System32/vcruntime140.dll')
    const vcRuntime1 = path.join(systemRoot, 'System32/vcruntime140_1.dll') // Python 3.10+ 需要此文件
    const sysWow64 = path.join(systemRoot, 'SysWOW64/vcruntime140.dll')
    const sysWow64_1 = path.join(systemRoot, 'SysWOW64/vcruntime140_1.dll')

    vcRedistInstalled = (await fs.pathExists(vcRuntime)) || (await fs.pathExists(sysWow64))

    const vcRedist1Installed =
      (await fs.pathExists(vcRuntime1)) || (await fs.pathExists(sysWow64_1))

    if (!vcRedistInstalled) {
      // vcruntime140.dll 是必须的，缺少才阻塞启动
      errors.push('关键系统组件缺失: VCRUNTIME140.dll。请安装 Visual C++ Redistributable。')
    }
    if (!vcRedist1Installed) {
      // vcruntime140_1.dll 仅 Python 3.10+ 需要，缺少时仅记录警告，不阻断启动
      // 让 Python 进程自己决定是否能正常运行，而不是在诊断阶段就阻塞
      logger.warn('Main', '[诊断] 未找到 vcruntime140_1.dll (仅影响 Python 3.10+，否则可忽略)')
    }
  }

  // 6. 检查 Node.js
  let nodePath = ''
  let nodeExists = false
  let nodeVersion = 'Unknown'

  // NapCat 通常捆绑了 node，或者我们查找系统 node
  // 注意：NapCat 逻辑将是分开的，但这里我们检查通用的 node 可用性
  const nodeTrials = [
    path.join(resourceDir, 'nodejs/node.exe'),
    path.join(resourceDir, 'bin/node.exe'),
    path.join(resourceDir, 'node.exe')
  ]

  for (const trial of nodeTrials) {
    if (await fs.pathExists(trial)) {
      nodePath = trial
      nodeExists = true
      break
    }
  }

  if (!nodeExists) {
    try {
      nodePath = await which('node')
      nodeExists = true
    } catch {
      // 在路径中未找到
    }
  }

  if (nodeExists) {
    try {
      nodeVersion = execSync(`"${nodePath}" --version`, { encoding: 'utf8' }).trim()
    } catch {
      // 忽略
    }
  }

  // 检查 NapCat
  let napcatInstalled = false
  try {
    napcatInstalled = checkNapCatInstalled()
    logger.info('Main', `[诊断] checkNapCatInstalled 结果: ${napcatInstalled}`)
  } catch (e) {
    logger.error('Main', `[诊断] checkNapCatInstalled 错误: ${e}`)
  }

  // 7. 检查 AI 模型状态
  let embeddingModelExists = false
  let rerankerModelExists = false
  let whisperModelExists = false

  if (pythonExists) {
    try {
      // 构造 model_cli.py 的路径
      // 在开发环境中：backend/utils/model_cli.py
      // 在生产环境中：resources/backend/utils/model_cli.py (或者与 main.py 同级)

      let cliScript = path.join(workspaceRoot, 'backend/utils/model_cli.py')
      if (!(await fs.pathExists(cliScript))) {
        cliScript = path.join(resourceDir, 'backend/utils/model_cli.py')
      }
      if (!(await fs.pathExists(cliScript))) {
        // 尝试相对于 main.py 寻找
        cliScript = path.join(path.dirname(scriptPath), 'utils/model_cli.py')
      }

      // [修复] 增加对 CWD 的回退检查
      if (!(await fs.pathExists(cliScript))) {
        const cwdPath = path.join(process.cwd(), 'backend/utils/model_cli.py')
        if (await fs.pathExists(cwdPath)) {
          cliScript = cwdPath
        }
      }

      if (await fs.pathExists(cliScript)) {
        logger.info('Main', `[诊断] 正在检查模型状态: ${cliScript}`)
        const { spawnSync } = require('child_process')
        const env = { ...process.env }

        // [环境隔离] 移除可能污染我们嵌入式 Python 实例的系统或用户环境变量
        Object.keys(env).forEach((key) => {
          if (key.startsWith('PYTHON') && key !== 'PATH' && key !== 'PYTHONPATH') {
            delete env[key]
          }
        })

        // 核心 Python 环境设置
        const pythonDir = path.dirname(pythonPath)
        const isEmbeddedPython =
          pythonPath.includes(path.join('resources', 'python')) ||
          pythonPath.includes(path.join('resources\\python'))

        if (isDev) {
          if (!pythonPath.toLowerCase().includes('.venv') && !pythonPath.toLowerCase().includes('venv')) {
            env['PYTHONHOME'] = pythonDir
          } else {
            delete env['PYTHONHOME']
          }
          env['PYTHONPATH'] = workspaceRoot
        } else if (isEmbeddedPython) {
          // 嵌入式 Python 不设 PYTHONHOME，避免干扰其通过 .pth 的自我发现
          delete env['PYTHONHOME']
          env['PYTHONPATH'] = `${resourceDir}${path.delimiter}${path.join(resourceDir, 'backend')}`
        } else {
          env['PYTHONHOME'] = pythonDir
          env['PYTHONPATH'] = `${resourceDir}${path.delimiter}${path.join(resourceDir, 'backend')}`
        }
        env['PYTHONNOUSERSITE'] = '1'
        env['PYTHONUTF8'] = '1'
        env['PYTHONUNBUFFERED'] = '1'

        const result = spawnSync(pythonPath, [cliScript, 'check'], {
          encoding: 'utf8',
          env: env
        })

        const statusJson = (result.stdout || '').toString().trim()

        if (result.error || result.status !== 0) {
          const errorMsg = result.stderr
            ? result.stderr.toString()
            : result.error
              ? result.error.message
              : 'Unknown error'
          throw new Error(`Command failed with status ${result.status}: ${errorMsg}`)
        }

        try {
          const status = JSON.parse(statusJson)
          embeddingModelExists = status['embedding']?.exists || false
          rerankerModelExists = status['reranker']?.exists || false
          // 只要有一个 whisper 模型存在就算存在，或者检查默认的 tiny
          whisperModelExists = status['tiny']?.exists || false
        } catch (e) {
          logger.error('Main', `[诊断] 解析模型状态 JSON 失败: ${e}`)
        }
      } else {
        logger.warn('Main', `[诊断] 未找到 model_cli.py 脚本`)
      }
    } catch (e: any) {
      logger.error('Main', `[诊断] 模型状态检查失败: ${e.message}`)
    }
  }

  return {
    python_exists: pythonExists,
    python_path: pythonPath,
    python_version: pythonVersion,
    script_exists: scriptExists,
    script_path: scriptPath,
    port_9120_free: port9120Free,
    data_dir_writable: dataDirWritable,
    data_dir: dataDir,
    core_available: coreAvailable,
    vc_redist_installed: vcRedistInstalled,
    napcat_installed: napcatInstalled,
    webview2_installed: true, // Electron 捆绑了 Chromium
    node_exists: nodeExists,
    node_path: nodePath,
    node_version: nodeVersion,
    embedding_model_exists: embeddingModelExists,
    reranker_model_exists: rerankerModelExists,
    whisper_model_exists: whisperModelExists,
    errors
  }
}

import net from 'net'
function checkPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false)
      } else {
        resolve(true) // 其他错误视为端口空闲
      }
    })
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port)
  })
}

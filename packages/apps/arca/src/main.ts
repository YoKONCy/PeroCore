/**
 * main — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import path from 'node:path'
import { ArcaApplicationHost } from './applicationHost'

function numberFlag(name: string): number | undefined {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`参数 --${name} 必须是 0-65535 的整数`)
  }
  return parsed
}

const dataPath = process.env.INFOS_ARCA_DATA_PATH ?? path.resolve(process.cwd(), '.arca')
const discoveryPath = process.env.INFOS_ARCA_DISCOVERY_PATH
const host = new ArcaApplicationHost({ dataPath, discoveryPath })
const loopbackPort = numberFlag('loopback-port') ?? 0
const result = await host.start({ loopbackPort })
process.stdout.write(`Arca自治Host已监听 ws://127.0.0.1:${result.loopbackPort}\n`)
process.stdout.write(`${JSON.stringify(host.diagnostics())}\n`)

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  await host.stop()
  process.exit(0)
}

const ownerPid = Number(process.env.INFOS_ARCA_OWNER_PID)
if (Number.isInteger(ownerPid) && ownerPid > 0) {
  const ownerWatch = setInterval(() => {
    try {
      process.kill(ownerPid, 0)
    } catch {
      process.stdout.write(`Arca托管进程检测到Kernel已退出，正在收口: owner=${ownerPid}\n`)
      clearInterval(ownerWatch)
      void shutdown()
    }
  }, 1_000)
  ownerWatch.unref()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

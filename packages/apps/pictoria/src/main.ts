import path from 'node:path'
import { PictoriaHost } from './host'
import type { HostPort } from './domain'
import { ProcessLifetime } from './processLifetime'
import { setLocale } from '@infos/shared/i18n'
setLocale(process.env.INFOS_LANGUAGE ?? process.env.LANG)

const callback = process.env.INFOS_PICTORIA_CALLBACK
const callbackKey = process.env.INFOS_PICTORIA_CALLBACK_KEY
const standalone = process.argv.includes('--standalone') || !callback
const dataPath =
  (standalone ? process.env.PICTORIA_DATA_PATH : process.env.INFOS_PICTORIA_DATA_PATH) ??
  path.resolve('.pictoria')
const port: HostPort | undefined =
  callback && callbackKey
    ? {
        async generate(input, signal) {
          const response = await fetch(callback, {
            method: 'POST',
            headers: { authorization: `Bearer ${callbackKey}`, 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal,
            redirect: 'error',
          })
          if (!response.ok) {
            const error = new Error(`宿主模型请求失败：HTTP ${response.status}`)
            Object.assign(error, {
              definitiveRejection:
                response.status >= 400 && response.status < 500 && response.status !== 408,
            })
            throw error
          }
          return (await response.json()) as Record<string, unknown>
        },
      }
    : undefined
const selectedPort =
  process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) ??
  (standalone ? process.env.PICTORIA_HTTP_PORT : undefined)
const httpPort = selectedPort === undefined ? (standalone ? 7364 : 0) : Number(selectedPort)
if (!Number.isInteger(httpPort) || httpPort < 0 || httpPort > 65535)
  throw new Error('Pictoria 端口无效')
const host = new PictoriaHost({
  dataPath,
  discoveryPath:
    (!standalone ? process.env.INFOS_PICTORIA_DISCOVERY_PATH : undefined) ??
    path.join(dataPath, 'discovery.json'),
  host: standalone ? undefined : port,
  standalone,
  httpPort,
  uiRoot: process.env.PICTORIA_UI_ROOT,
  developmentUi: process.argv.includes('--dev-ui'),
  bindDesktop: standalone ? undefined : (value) => lifetime.bindDesktop(value),
  shutdown: () => lifetime.shutdown(),
})
const ownerPid = standalone ? 0 : Number(process.env.INFOS_PICTORIA_OWNER_PID)
const lifetime: ProcessLifetime = new ProcessLifetime(() => host.stop(), ownerPid)
process.once('SIGINT', () => void lifetime.shutdown())
process.once('SIGTERM', () => void lifetime.shutdown())
try {
  if (!standalone && process.env.INFOS_PICTORIA_DESKTOP_GUARD)
    await lifetime.bindDesktop(JSON.parse(process.env.INFOS_PICTORIA_DESKTOP_GUARD))
  lifetime.assertRunning()
  await host.start()
  lifetime.assertRunning()
  process.stdout.write('Pictoria 后台已就绪\n')
  if (host.browserUrl) process.stdout.write(`打开画布：${host.browserUrl}\n`)
} catch (failure) {
  process.stderr.write(
    `Pictoria 启动失败：${failure instanceof Error ? failure.message : '未知错误'}\n`,
  )
  await lifetime.shutdown(1)
}

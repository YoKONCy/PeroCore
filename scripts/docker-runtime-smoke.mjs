import { t as __t } from './i18n.mjs'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

const origin = new URL(process.argv[2] ?? 'http://localhost:3000')
const token = process.env.INFOS_API_TOKEN ?? ''
const started = []

async function request(application, action, method = 'GET') {
  const response = await fetch(new URL(`/api/applications/${application}/${action}`, origin), {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(60_000),
  })
  const result = await response.json()
  assert.ok(
    response.ok && result.code === 'OK',
    `${application} ${action} 失败：${result.message ?? response.status}`,
  )
  return result.data
}

async function checkArcaSocket() {
  const address = new URL('/api/applications/arca/transport', origin)
  address.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:'
  if (token) address.searchParams.set('token', token)
  const socket = new WebSocket(address)
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('Arca 代理握手超时'))
      }, 10_000)
      const finish = (error) => {
        clearTimeout(timer)
        error ? reject(error) : resolve()
      }
      socket.addEventListener(
        'message',
        (event) => {
          try {
            const hello = JSON.parse(String(event.data))
            assert.equal(hello.type, 'hello')
            assert.equal(hello.application.appId, 'infos.arca')
            finish()
          } catch (error) {
            finish(error)
          }
        },
        { once: true },
      )
      socket.addEventListener('error', () => finish(new Error('Arca 代理连接失败')), { once: true })
      socket.addEventListener('close', () => finish(new Error('Arca 在握手前关闭')), { once: true })
    })
  } finally {
    socket.close()
  }
}

const failures = []
try {
  for (const application of ['arca', 'pictoria']) {
    const before = await request(application, 'status')
    assert.equal(before.ownership, 'offline', '冒烟测试需要未启动应用的独立测试容器')
    assert.equal(before.managedRuntimeAvailable, true, `${application} 发行资源不完整`)
    // 启动请求失败也尝试回收，避免留下半启动的子进程。
    started.push(application)
    const status = await request(application, 'start', 'POST')
    assert.equal(status.ownership, 'managed')
    assert.equal(status.federation.state, 'connected')
    if (application === 'arca') await checkArcaSocket()
    console.log(
      __t('scripts.docker-runtime-smoke', 'Docker 子应用启动与连接通过：{0}', [application]),
    )
  }
} catch (error) {
  failures.push(error)
}
for (const application of started.reverse()) {
  try {
    await request(application, 'stop', 'POST')
    let status
    for (let attempt = 0; attempt < 40; attempt++) {
      status = await request(application, 'status')
      if (status.ownership === 'offline') break
      await delay(500)
    }
    assert.equal(status.ownership, 'offline', `${application} 未完成生命周期回收`)
    console.log(__t('scripts.docker-runtime-smoke', 'Docker 子应用停止通过：{0}', [application]))
  } catch (error) {
    failures.push(error)
  }
}
if (failures.length) throw new AggregateError(failures, 'Docker 子应用冒烟失败')

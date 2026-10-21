import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '@infos/backend/database/schema'
import { createDrizzleConnection, closeDrizzleConnection } from '@infos/backend/database'
import { DurableNotificationRepository } from '@infos/backend/repositories/durableNotification.repo'
import { GatewayHub } from '@infos/backend/services/gateway/gatewayHub'
import { createEnvelope, type GatewayEnvelope } from '@infos/backend/services/gateway/types'
import { createNotificationTargetFilter } from '@infos/backend/services/gateway/notificationTargetFilter'

let sqlite: Database.Database
let connection: ReturnType<typeof createDrizzleConnection>
let notifications: DurableNotificationRepository
let hub: GatewayHub

beforeEach(() => {
  // 使用生产初始化流程，同时覆盖迁移链与启动补表维护的字段。
  connection = createDrizzleConnection(':memory:')
  sqlite = (connection as unknown as { $client: Database.Database }).$client
  notifications = new DurableNotificationRepository(connection)
  hub = new GatewayHub(undefined, notifications)
})

afterEach(() => {
  vi.restoreAllMocks()
  closeDrizzleConnection(connection)
})

async function connect(connectionId: string, deviceId: string, profile = 'notifications') {
  const messages: GatewayEnvelope[] = []
  hub.registerNode(
    connectionId,
    (data) => {
      messages.push(JSON.parse(data) as GatewayEnvelope)
    },
    undefined,
    true,
    deviceId,
  )
  const send = async (type: GatewayEnvelope['type'], payload: Record<string, unknown>) => {
    await hub.handleMessage(JSON.stringify(createEnvelope(type, payload, 'backend')), connectionId)
    return messages.at(-1)!
  }
  await send('hello', { profile, principalId: 'pero', supportedVersions: [1] })
  return { messages, send }
}

const create = (notificationId: string, extra = {}) =>
  notifications.create({
    notificationId,
    principalId: 'pero',
    audience: { type: 'all_principal_clients', principalId: 'pero' },
    title: '已完成',
    level: 'success',
    status: 'unread',
    revision: 1,
    createdAt: new Date().toISOString(),
    ...extra,
  })

describe('设备通知补收', () => {
  it('通知和持久游标同事务，序列写入失败不会留下不可补收的通知', () => {
    sqlite.exec(
      "CREATE TRIGGER reject_notification_feed BEFORE INSERT ON notification_feed BEGIN SELECT RAISE(ABORT, '模拟写入失败'); END",
    )
    expect(() => create('incomplete')).toThrow('模拟写入失败')
    expect(notifications.list('pero')).toHaveLength(0)
  })
  it('离线产生的通知与序号留在数据库，重新建立 Hub 后仍能补收', async () => {
    await hub.pushNotification({
      title: '已回复',
      important: true,
      principalId: 'pero',
      notificationId: 'reply',
      delivery: 'background',
      target: { kind: 'conversation', agentId: 'pero', threadId: 'chat', messageId: 'message' },
    })
    hub = new GatewayHub(undefined, new DurableNotificationRepository(drizzle(sqlite, { schema })))
    const phone = await connect('phone', 'device-phone')
    expect(phone.messages[0]?.payload).toMatchObject({
      profile: 'notifications',
      latestSequence: 1,
    })
    const page = await phone.send('request', {
      action: 'gateway.notifications.pull',
      afterSequence: 0,
    })
    expect(page.payload).toMatchObject({
      nextSequence: 1,
      hasMore: false,
      notifications: [
        { notificationId: 'reply', target: { threadId: 'chat', messageId: 'message' } },
      ],
    })
    expect(create('reply')).toBe(false)
    expect(notifications.latestSequence()).toBe(1)
  })

  it('接收与展示只作用于自己的设备，真正已读才使其他设备停止补收', () => {
    create('task')
    notifications.acknowledgeDevice('desktop', [
      { notificationId: 'task', revision: 1, state: 'presented' },
    ])
    expect(notifications.page('desktop', 0, 50).notifications).toHaveLength(0)
    expect(notifications.page('phone', 0, 50).notifications).toHaveLength(1)
    notifications.acknowledgeDevice('phone', [
      { notificationId: 'task', revision: 1, state: 'received' },
    ])
    expect(notifications.list('pero', 'unread')).toHaveLength(1)
    notifications.acknowledgeDevice('phone', [
      { notificationId: 'task', revision: 1, state: 'read' },
    ])
    expect(notifications.page('another-phone', 0, 50).notifications).toHaveLength(0)
    expect(notifications.list('pero', 'read')[0]?.revision).toBe(2)
  })

  it('过滤空页仍推进游标，支持分页和旧快照游标复位', () => {
    create('expired', { expiresAt: new Date(Date.now() - 1).toISOString() })
    create('received')
    create('pending')
    notifications.acknowledgeDevice('phone', [
      { notificationId: 'received', revision: 1, state: 'received' },
    ])
    expect(notifications.page('phone', 0, 2)).toMatchObject({
      notifications: [],
      nextSequence: 2,
      hasMore: true,
    })
    expect(notifications.page('phone', 2, 2).notifications[0]?.notificationId).toBe('pending')
    expect(notifications.page('phone', 99, 2)).toMatchObject({
      resetRequired: true,
      nextSequence: 0,
    })
    expect(
      notifications.acknowledgeDevice('phone', [
        { notificationId: 'pending', revision: 99, state: 'received' },
      ]),
    ).toBe(0)
  })

  it('长任务只传通知预览，后台通道不传整份任务结果', () => {
    create('long-result', { body: '完整任务正文'.repeat(1000) })
    const item = notifications.page('phone', 0, 50).notifications[0]!
    expect(item.body?.length).toBeLessThanOrEqual(1000)
    expect(item.body?.endsWith('…')).toBe(true)
    expect(notifications.list('pero')[0]?.body?.length).toBeGreaterThan(1000)
  })

  it('通知连接只收到轻量唤醒提示，不能调用工具、抢输入席位或广播', async () => {
    const phone = await connect('phone', 'device-phone')
    const request = vi.fn()
    const abort = vi.fn()
    hub.on('request', request)
    hub.on('abort', abort)
    for (const action of [
      'input_seat.acquire',
      'gateway.subscribe',
      'chat',
      'gateway.select_principal',
    ]) {
      expect((await phone.send('request', { action })).payload.code).toBe(
        'GATEWAY_NOTIFICATION_ONLY',
      )
    }
    await phone.send('abort', {})
    expect(request).not.toHaveBeenCalled()
    expect(abort).not.toHaveBeenCalled()
    phone.messages.length = 0
    await connect('other-client', 'other-device', 'full')
    await hub.handleMessage(
      JSON.stringify(createEnvelope('response', { injected: true }, 'phone')),
      'other-client',
    )
    await hub.pushStateUpdate({ privateData: '不属于通知通道' })
    await hub.pushNotification({ title: '完成', important: true, notificationId: 'new' })
    expect(phone.messages.map((message) => message.payload.action)).toEqual([
      'notification_available',
    ])
    expect(phone.messages[0]?.payload).toEqual({
      action: 'notification_available',
      latestSequence: 1,
    })
  })

  it('同设备前台会话只静默落盘，其他设备和过期前台状态不会抑制通知', async () => {
    create('reply', {
      metadata: { target: { kind: 'conversation', agentId: 'pero', threadId: 'chat' } },
    })
    const foreground = await connect('ui', 'device-phone', 'full')
    const phone = await connect('background', 'device-phone')
    const other = await connect('other', 'another-phone')
    await foreground.send('request', {
      action: 'gateway.notifications.presence',
      foreground: true,
      threadId: 'chat',
    })
    const pull = { action: 'gateway.notifications.pull', afterSequence: 0 }
    expect((await phone.send('request', pull)).payload.notifications).toMatchObject([
      { presentation: 'silent' },
    ])
    expect((await other.send('request', pull)).payload.notifications).toMatchObject([
      { presentation: 'notify' },
    ])
    const later = Date.now() + 91_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    expect((await phone.send('request', pull)).payload.notifications).toMatchObject([
      { presentation: 'notify' },
    ])
  })

  it('旧桌面展示回执不再消耗手机待收记录，伪造设备字段无效', async () => {
    create('task')
    const desktop = await connect('desktop', 'desktop-device', 'full')
    await desktop.send('request', {
      action: 'gateway.notifications.ack',
      principalId: 'pero',
      receipts: [{ notificationId: 'task', revision: 1 }],
    })
    expect(notifications.page('phone-device', 0, 50).notifications).toHaveLength(1)
    const phone = await connect('phone', 'phone-device')
    await phone.send('request', {
      action: 'gateway.notifications.receipt',
      deviceId: 'victim',
      receipts: [{ notificationId: 'task', revision: 1, state: 'received' }],
    })
    expect(notifications.page('phone-device', 0, 50).notifications).toHaveLength(0)
    expect(notifications.page('victim', 0, 50).notifications).toHaveLength(1)
  })

  it('通知服务必须有传输层认证身份，不能靠 hello 伪造', async () => {
    const messages: GatewayEnvelope[] = []
    hub.registerNode('unpaired', (raw) => {
      messages.push(JSON.parse(raw) as GatewayEnvelope)
    })
    await hub.handleMessage(
      JSON.stringify(createEnvelope('hello', { profile: 'notifications', deviceId: 'victim' })),
      'unpaired',
    )
    expect(messages.at(-1)?.payload.code).toBe('GATEWAY_DEVICE_AUTH_REQUIRED')
  })

  it('HTTP 已验证的设备身份优先，不把手机令牌误当实例令牌拒绝', async () => {
    hub = new GatewayHub(undefined, notifications, 'instance-admin-token')
    const messages: GatewayEnvelope[] = []
    hub.registerNode(
      'paired',
      (raw) => {
        messages.push(JSON.parse(raw) as GatewayEnvelope)
      },
      undefined,
      true,
      'phone-device',
    )
    await hub.handleMessage(
      JSON.stringify(
        createEnvelope('hello', {
          profile: 'notifications',
          supportedVersions: [1],
          token: 'paired-device-token',
        }),
      ),
      'paired',
    )
    expect(messages.at(-1)?.type).toBe('hello_ack')
    expect(messages.at(-1)?.payload.deviceId).toBe('phone-device')
  })

  it('补收前过滤被撤回的消息和不存在的任务，空页仍保存扫描进度', async () => {
    hub.addNotificationSuppression(createNotificationTargetFilter(drizzle(sqlite, { schema })))
    create('deleted-reply', {
      metadata: {
        target: { kind: 'conversation', agentId: 'pero', threadId: 'deleted', messageId: '1' },
      },
    })
    create('deleted-task', {
      metadata: { target: { kind: 'task', agentId: 'pero', taskId: 'deleted' } },
    })
    create('reminder')
    const phone = await connect('phone', 'device')
    expect(
      (await phone.send('request', { action: 'gateway.notifications.pull', limit: 2 })).payload,
    ).toMatchObject({ notifications: [], nextSequence: 2, hasMore: true })
    expect(notifications.list('pero', 'read')).toHaveLength(2)
    expect(
      (await phone.send('request', { action: 'gateway.notifications.pull', afterSequence: 2 }))
        .payload.notifications,
    ).toMatchObject([{ notificationId: 'reminder' }])
  })

  it('已保存的有效回复可以补收，随后撤回该消息会停止补发', async () => {
    const db = drizzle(sqlite, { schema })
    db.insert(schema.threads).values({ id: 'chat', agentId: 'pero', channel: 'desktop' }).run()
    const message = db
      .insert(schema.threadMessages)
      .values({ threadId: 'chat', role: 'assistant', content: '已保存的回复' })
      .returning({ id: schema.threadMessages.id })
      .get()!
    hub.addNotificationSuppression(createNotificationTargetFilter(db))
    create('reply', {
      metadata: {
        target: {
          kind: 'conversation',
          agentId: 'pero',
          threadId: 'chat',
          messageId: String(message.id),
        },
      },
    })
    const phone = await connect('phone', 'device')
    const pull = { action: 'gateway.notifications.pull', afterSequence: 0 }
    expect((await phone.send('request', pull)).payload.notifications).toHaveLength(1)
    db.update(schema.threadMessages)
      .set({ status: 'deleted' })
      .where(eq(schema.threadMessages.id, message.id))
      .run()
    expect((await phone.send('request', pull)).payload.notifications).toHaveLength(0)
  })
})

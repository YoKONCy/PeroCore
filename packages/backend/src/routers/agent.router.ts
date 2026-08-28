/**
 * Agent Router — 角色管理 API
 *
 * 提供 Agent CRUD + Capabilities 端点：
 * - GET    /api/agents           列出所有 Agent
 * - GET    /api/agents/active    获取默认 Agent（AIOS: 不再有全局活跃概念）
 * - GET    /api/agents/:id       获取单个 Agent 详情
 * - POST   /api/agents           创建自定义 Agent (B6-3)
 * - DELETE /api/agents/:id       删除自定义 Agent (B6-3)
 * - POST   /api/agents/:id/enable   启用 Agent (D54)
 * - POST   /api/agents/:id/disable  禁用 Agent (D54)
 * - GET    /api/agents/:id/capabilities  获取 Agent 能力配置 (B6-3)
 * - POST   /api/agents/reload       重载 Agent 目录
 *
 * @module packages/backend/src/routers/agent.router
 */

import { Hono } from 'hono'
import { validate as zValidator } from '../lib/validation'
import { z } from 'zod'
import { AppError } from '../lib/appError'
import type { AppContext } from '../container'
import { resolveToolUserDescription, resolveToolUserLabel } from '../tools/toolUserLabels'
import { isAdvancedTool } from '../tools/advancedTools'
import { isSystemProtocolTool } from '../tools/systemProtocolTools'

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

// AIOS: switchAgentSchema 已移除（PUT /api/agents/active 路由已删除）

const createAgentSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_-]+$/, 'ID 只允许小写字母、数字、下划线和短横线'),
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  /** 该 Agent 对用户的称呼（未指定时兜底"主人"） */
  ownerAppellation: z.string().max(20).optional(),
  /** 初始人设正文（未指定时写入默认骨架） */
  systemPrompt: z.string().optional(),
})

const publicProfileSchema = z.object({
  gender: z.string().max(50).optional(),
  identity: z.string().max(500).optional(),
  appearance: z.string().max(1000).optional(),
  personality: z.string().max(1000).optional(),
})

/** 更新 Agent 的字段（全部可选，按需覆盖） */
const updateAgentSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(200).optional(),
  publicProfile: publicProfileSchema.optional(),
  ownerAppellation: z.string().max(20).optional(),
  systemPrompt: z.string().optional(),
  channelPatches: z.record(z.string()).optional(),
  waifuTexts: z.record(z.unknown()).optional(),
})

/** 能力矩阵更新（各 channel 的工具/技能/提示词片段） */
const updateChannelsSchema = z.record(
  z.string(),
  z.object({
    tools: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    promptFragments: z.array(z.string()).optional(),
  }),
)

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

export function createAgentRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/agents — 列出所有 Agent (含 avatarUrl)
  router.get('/', (c) => {
    const agents = ctx.agentManager.listAgents().map((a) => ({
      ...a,
      avatarUrl: `/agents/${a.id}/avatar`,
    }))
    return c.json({ code: 'OK', message: '获取成功', data: agents })
  })

  // GET /api/agents/active — 获取后端权威的全局活跃 Agent
  router.get('/active', (c) => {
    const agentId = ctx.runtimeStateService.getActiveAgent() ?? ctx.agentManager.defaultAgentId
    const agent = ctx.agentManager.getAgent(agentId)
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: '当前没有默认 Agent',
        data: { agentId: ctx.agentManager.defaultAgentId },
      })
    }
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        agentId: agent.id,
        id: agent.id,
        name: agent.name,
        description: agent.description,
        avatarPath: agent.avatarPath,
      },
    })
  })

  // GET /api/agents/tools — 全部已注册工具清单 (供能力矩阵表单勾选 + 前端轨迹区显示元数据)
  // 必须注册在 /:id 之前，避免被参数路由吞掉
  router.get('/tools', (c) => {
    const channelNames = ['desktop', 'group'] as const
    const tools = ctx.toolRegistry
      .getDefinitions()
      .filter((definition) => !isAdvancedTool(definition.name))
      .map((d) => ({
        name: d.name,
        description: resolveToolUserDescription(d.name, d.display?.description, d.description),
        channels: channelNames.filter((channel) =>
          ctx.toolRegistry.getDefinitions(channel).some((item) => item.name === d.name),
        ),
        locked: isSystemProtocolTool(d.name),
        display: { ...d.display, label: resolveToolUserLabel(d.name, d.display?.label) },
      }))
    return c.json({ code: 'OK', message: '获取成功', data: tools })
  })

  // GET /api/agents/companion-states — 批量获取全部 Agent 的陪伴调度只读状态
  // 必须注册在 /:id 路由之前，避免被参数路由吞掉。
  router.get('/companion-states', (c) => {
    const agentIds = ctx.agentManager.listAgents().map((agent) => agent.id)
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: ctx.companionSchedulerService.listStates(agentIds),
    })
  })

  // GET /api/agents/:id/export — 生成客户端可落盘的角色资源包描述。
  router.get('/:id/export', (c) => {
    const id = c.req.param('id')
    try {
      return c.json({
        code: 'OK',
        message: '角色包已生成',
        data: ctx.agentManager.exportAgentPackage(id),
      })
    } catch (error) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: error instanceof Error ? error.message : String(error),
        data: { agentId: id },
      })
    }
  })

  // GET /api/agents/:id/avatar — 获取 Agent 头像图片
  router.get('/:id/avatar', (c) => {
    const agentId = c.req.param('id')
    const avatarData = ctx.agentManager.getAvatarData(agentId)
    if (!avatarData) {
      return c.json({ code: 'NOT_FOUND', message: '该 Agent 没有头像' }, 404)
    }
    c.header('Content-Type', avatarData.mime)
    c.header('Cache-Control', 'public, max-age=3600')
    return c.body(new Uint8Array(avatarData.buffer))
  })

  // POST /api/agents/:id/avatar — 接收客户端裁切后的 PNG，并由 Service 写入角色资源目录
  router.post('/:id/avatar', async (c) => {
    const id = c.req.param('id')
    if (!ctx.agentManager.getAgent(id)) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }

    const body = await c.req.parseBody()
    const file = body.avatar
    if (!(file instanceof File)) {
      throw new AppError('MISSING_FIELD', { message: '请上传裁切后的头像文件' })
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      throw new AppError('PAYLOAD_TOO_LARGE', { message: '头像文件应大于 0 且不超过 5MB' })
    }

    const image = Buffer.from(await file.arrayBuffer())
    const isPng =
      image.length >= 8 &&
      image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    if (!isPng) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', { message: '仅支持客户端裁切生成的 PNG 头像' })
    }

    ctx.agentManager.saveAvatar(id, image)
    return c.json({
      code: 'OK',
      message: '角色头像已更新',
      data: { avatarUrl: `/agents/${id}/avatar` },
    })
  })

  // AIOS: PUT /api/agents/active 已移除（setActiveAgent 方法已删除）
  // 不再允许运行时切换全局活跃 Agent，前端窗口级状态由 RuntimeStateService 管理。

  // GET /api/agents/:id/companion — 获取该 Agent 的陪伴调度状态
  router.get('/:id/companion', (c) => {
    const id = c.req.param('id')
    if (!ctx.agentManager.getAgent(id)) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: { agentId: id, enabled: ctx.companionSchedulerService.isRunning(id) },
    })
  })

  // PUT /api/agents/:id/companion — 启用或停止该 Agent 的陪伴调度
  router.put(
    '/:id/companion',
    zValidator('json', z.object({ enabled: z.boolean() })),
    async (c) => {
      const id = c.req.param('id')
      const { enabled } = c.req.valid('json')
      if (!ctx.agentManager.getAgent(id)) {
        throw new AppError('AGENT_NOT_FOUND', {
          message: `Agent "${id}" 不存在`,
          data: { agentId: id },
        })
      }

      if (enabled) ctx.companionSchedulerService.start(id)
      else await ctx.companionSchedulerService.stop(id)

      const running = ctx.companionSchedulerService.isRunning(id)
      return c.json({
        code: 'OK',
        message: running ? '陪伴模式已启用' : '陪伴模式已关闭',
        data: { agentId: id, enabled: running },
      })
    },
  )

  // GET /api/agents/:id — 获取单个 Agent 完整可编辑详情 (B6-3)
  router.get('/:id', (c) => {
    const id = c.req.param('id')
    // 排除特殊路径防止与 /active /reload /tools 冲突
    if (id === 'active' || id === 'reload' || id === 'tools') return c.notFound()

    const detail = ctx.agentManager.getAgentDetail(id)
    if (!detail) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        ...detail,
        avatarPath: ctx.agentManager.getAgent(id)?.avatarPath ?? null,
        avatarUrl: `/agents/${id}/avatar`,
      },
    })
  })

  // POST /api/agents — 创建自定义 Agent (B6-3)
  router.post('/', zValidator('json', createAgentSchema), async (c) => {
    const body = c.req.valid('json')

    try {
      const profile = ctx.agentManager.createAgent({
        id: body.id,
        name: body.name,
        description: body.description,
        ownerAppellation: body.ownerAppellation,
        systemPrompt: body.systemPrompt,
      })
      // 新角色的 capabilities.yaml 需要让 CapabilityGate 重新扫描加载
      ctx.capabilityGate.reloadAll()
      await ctx.strongholdService.ensureAgentLocation(profile.id)
      return c.json(
        {
          code: 'CREATED',
          message: `Agent "${profile.id}" 创建成功`,
          data: { id: profile.id, name: profile.name, description: profile.description },
        },
        201,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new AppError('ALREADY_EXISTS', {
        message: msg,
        data: { resource: 'agent' },
      })
    }
  })

  // PUT /api/agents/:id — 更新 Agent 配置（基础信息/称呼/人设/补丁/社交/台词）
  router.put('/:id', zValidator('json', updateAgentSchema), (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')

    try {
      const profile = ctx.agentManager.updateAgent(id, body)
      return c.json({
        code: 'OK',
        message: `Agent "${id}" 已更新`,
        data: { id: profile.id, name: profile.name, ownerAppellation: profile.ownerAppellation },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new AppError('UNPROCESSABLE', {
        message: msg,
        data: { agentId: id },
      })
    }
  })

  // DELETE /api/agents/:id — 删除自定义 Agent (B6-3)
  router.delete('/:id', (c) => {
    const id = c.req.param('id')

    try {
      ctx.agentManager.deleteAgent(id)
      return c.json({ code: 'OK', message: `Agent "${id}" 已删除` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('不存在')) {
        throw new AppError('AGENT_NOT_FOUND', {
          message: msg,
          data: { agentId: id },
        })
      }
      throw new AppError('UNPROCESSABLE', {
        message: msg,
        data: { agentId: id },
      })
    }
  })

  // POST /api/agents/:id/enable — 启用 Agent
  router.post('/:id/enable', async (c) => {
    const id = c.req.param('id')
    const success = ctx.agentManager.enableAgent(id)
    if (!success) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `无法启用 Agent: ${id}`,
        data: { agentId: id },
      })
    }
    await ctx.strongholdService.ensureAgentLocation(id)
    return c.json({ code: 'OK', message: `Agent ${id} 已启用` })
  })

  // POST /api/agents/:id/disable — 禁用 Agent
  router.post('/:id/disable', (c) => {
    const id = c.req.param('id')
    const success = ctx.agentManager.disableAgent(id)
    if (!success) {
      throw new AppError('UNPROCESSABLE', {
        message: `无法禁用 Agent: ${id} (可能是当前主角色)`,
        data: { agentId: id },
      })
    }
    return c.json({ code: 'OK', message: `Agent ${id} 已禁用` })
  })

  // GET /api/agents/:id/capabilities — 获取 Agent 能力配置 (结构化，供前端表单化编辑)
  router.get('/:id/capabilities', (c) => {
    const id = c.req.param('id')
    const agent = ctx.agentManager.getAgent(id)
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }

    // 从 CapabilityGate 获取结构化的 channel 能力矩阵
    const channels = ctx.capabilityGate.getChannels(id)
    const skills = ctx.skillLoader.getAllManifests().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
    }))

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: { agentId: id, channels, skills },
    })
  })

  // PUT /api/agents/:id/capabilities — 更新 Agent 能力矩阵 (工具/技能/提示词片段)
  router.put('/:id/capabilities', zValidator('json', updateChannelsSchema), (c) => {
    const id = c.req.param('id')
    const channels = c.req.valid('json')

    const agent = ctx.agentManager.getAgent(id)
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }

    try {
      // 内置角色先确保用户副本（安装目录只读），再写回副本的 capabilities.yaml
      const writablePath = ctx.agentManager.getWritableCapabilitiesPath(id)
      ctx.capabilityGate.writeChannels(id, channels, writablePath)
      // 重新加载能力配置 + 角色配置，使新矩阵立即生效
      ctx.capabilityGate.reloadAll()
      return c.json({ code: 'OK', message: `Agent "${id}" 能力矩阵已更新` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new AppError('UNPROCESSABLE', {
        message: msg,
        data: { agentId: id },
      })
    }
  })

  // POST /api/agents/reload — 重载 Agent 目录
  router.post('/reload', (c) => {
    ctx.agentManager.reloadAgents()
    const agents = ctx.agentManager.listAgents()
    return c.json({
      code: 'OK',
      message: `已重载，共 ${agents.length} 个 Agent`,
      data: agents,
    })
  })

  // GET /api/agents/:id/texts — 获取 Agent 看板娘台词 (静态 + 动态合并)
  router.get('/:id/texts', async (c) => {
    const id = c.req.param('id')
    const texts = await ctx.agentManager.getWaifuTexts(id)
    if (!texts) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: texts,
    })
  })

  // GET /api/agents/:id/pet-state — 获取角色实时状态 (mood/vibe/mind + 动态台词)
  // 前端 Pet3D / Dashboard 启动时拉取，恢复 finish_task 持久化到 pet_states 的状态
  router.get('/:id/pet-state', async (c) => {
    const id = c.req.param('id')
    const state = await ctx.petStateService.get(id)
    const parse = <T>(text: string | null | undefined, fallback: T): T => {
      if (!text) return fallback
      try {
        return JSON.parse(text) as T
      } catch {
        return fallback
      }
    }
    const hasActiveTexts = ctx.petStateService.hasActiveTemporaryTexts(state)
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        agentId: id,
        mood: state?.mood ?? '开心',
        vibe: state?.vibe ?? '活泼',
        mind: state?.mind ?? '正在发呆...',
        clickMessages: hasActiveTexts
          ? parse<Record<string, string[]>>(state?.clickMessagesJson, {})
          : {},
        idleMessages: hasActiveTexts ? parse<string[]>(state?.idleMessagesJson, []) : [],
        backMessages: hasActiveTexts ? parse<string[]>(state?.backMessagesJson, []) : [],
        textExpiresAt: hasActiveTexts ? (state?.textExpiresAt ?? null) : null,
        updatedAt: state?.updatedAt ?? null,
      },
    })
  })

  return router
}

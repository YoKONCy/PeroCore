/**
 * strongholdOps — 据点空间管理工具
 *
 * 功能列表:
 * - stronghold_move_to_room     → 移动到房间
 * - stronghold_call_butler      → 呼叫管家
 * - stronghold_list_rooms       → 列出可用房间
 * - stronghold_get_room_info    → 查看房间详情
 * - stronghold_set_environment  → 调整环境变量
 *
 * 工具层通过注入的 StrongholdService 操作数据，
 * StrongholdService 已由 container.ts DI 注入。
 * 这些工具在 group_chat 模式下可用 (CapabilityGate)。
 *
 * @module packages/backend/src/tools/strongholdOps
 */

import type { BuiltinTool } from '../index'
import type { StrongholdService } from '../../services/stronghold/strongholdService'
import { createLogger } from '../../lib/logger'

const logger = createLogger('StrongholdOps')

// ─────────────────────────────────────────────
// Provider 注入
// ─────────────────────────────────────────────

/** 全局引用 */
let strongholdService: StrongholdService | null = null

/** 注入据点服务 (由 container.ts 调用) */
export function injectStrongholdService(service: StrongholdService): void {
  strongholdService = service
  logger.info('据点服务已注入')
}

/** 辅助: 检查 Service 可用性 */
function requireService(): StrongholdService | string {
  if (!strongholdService) {
    return JSON.stringify({
      error: '据点服务未初始化。当前环境不支持据点操作。',
    })
  }
  return strongholdService
}

// ─────────────────────────────────────────────
// stronghold_move_to_room — 移动到房间
// ─────────────────────────────────────────────

export const strongholdMoveToRoomTool: BuiltinTool = {
  definition: {
    name: 'stronghold_move_to_room',
    description: '移动到据点内的另一个房间。移动后你会进入该房间的群聊上下文。',
    parameters: {
      type: 'object',
      properties: {
        room_name: {
          type: 'string',
          description: '目标房间的名称 (如 "客厅"、"卧室"、"工作室")',
        },
      },
      required: ['room_name'],
    },
  },

  async execute(args, ctx) {
    const service = requireService()
    if (typeof service === 'string') return service

    const roomName = args.room_name as string
    const agentId = ctx.agentId

    try {
      const room = await service.getRoomByName(roomName)
      if (!room) {
        // 列出可用房间作为提示
        const allRooms = await service.listRooms()
        const names = allRooms.map((r) => r.name).join('、')
        return JSON.stringify({
          error: `找不到名为 "${roomName}" 的房间`,
          available_rooms: names,
          hint: `可用房间: ${names}`,
        })
      }

      await service.moveAgent(agentId, room.id)

      // 获取房间内其他角色
      const agents = await service.getRoomAgents(room.id)
      const others = agents.filter((a) => a !== agentId)

      return JSON.stringify({
        success: true,
        message: `已移动到 "${roomName}"`,
        room: {
          name: room.name,
          description: room.description,
          environment: JSON.parse(room.environmentJson ?? '{}'),
        },
        present_agents: others.length > 0 ? others : ['(空无一人)'],
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`移动到房间失败: ${errMsg}`)
      return JSON.stringify({ error: `移动失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// stronghold_list_rooms — 列出房间
// ─────────────────────────────────────────────

export const strongholdListRoomsTool: BuiltinTool = {
  definition: {
    name: 'stronghold_list_rooms',
    description: '列出据点内的所有可用房间及其简要信息。',
    parameters: { type: 'object', properties: {} },
  },

  async execute(_args, ctx) {
    const service = requireService()
    if (typeof service === 'string') return service

    try {
      const rooms = await service.listRooms()
      const agentId = ctx.agentId

      // 获取当前位置
      const currentRoom = await service.getAgentLocation(agentId)

      const roomList = await Promise.all(
        rooms.map(async (r) => {
          const agents = await service.getRoomAgents(r.id)
          return {
            name: r.name,
            description: r.description,
            agent_count: agents.length,
            is_current: currentRoom?.id === r.id,
          }
        }),
      )

      return JSON.stringify({
        success: true,
        rooms: roomList,
        current_room: currentRoom?.name ?? '(未定位)',
        total: roomList.length,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `列出房间失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// stronghold_get_room_info — 房间详情
// ─────────────────────────────────────────────

export const strongholdGetRoomInfoTool: BuiltinTool = {
  definition: {
    name: 'stronghold_get_room_info',
    description: '查看某个房间的详细信息，包括环境变量 (灯光/温度/音乐等) 和在场的角色。',
    parameters: {
      type: 'object',
      properties: {
        room_name: {
          type: 'string',
          description: '房间名称。不填则查看当前所在房间。',
        },
      },
    },
  },

  async execute(args, ctx) {
    const service = requireService()
    if (typeof service === 'string') return service

    try {
      let room
      const roomName = args.room_name as string | undefined

      if (roomName) {
        room = await service.getRoomByName(roomName)
      } else {
        room = await service.getAgentLocation(ctx.agentId)
      }

      if (!room) {
        return JSON.stringify({
          error: roomName ? `找不到房间 "${roomName}"` : '你当前没有在任何房间中',
        })
      }

      const agents = await service.getRoomAgents(room.id)
      const env = JSON.parse(room.environmentJson ?? '{}')

      return JSON.stringify({
        success: true,
        room: {
          name: room.name,
          description: room.description,
          environment: env,
          present_agents: agents,
        },
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `查看房间信息失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// stronghold_set_environment — 调整环境
// ─────────────────────────────────────────────

export const strongholdSetEnvironmentTool: BuiltinTool = {
  definition: {
    name: 'stronghold_set_environment',
    description: '调整当前所在房间的环境变量。例如调节灯光亮度、温度、播放音乐等。',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: '环境变量名 (如 "灯光"、"温度"、"音乐"、"清洁度")',
        },
        value: {
          type: 'string',
          description: '环境变量值 (如 "50"、"22"、"Lo-Fi Jazz")',
        },
      },
      required: ['key', 'value'],
    },
  },

  async execute(args, ctx) {
    const service = requireService()
    if (typeof service === 'string') return service

    const key = args.key as string
    const value = args.value as string

    try {
      const room = await service.getAgentLocation(ctx.agentId)
      if (!room) {
        return JSON.stringify({ error: '你当前没有在任何房间中，无法调整环境。' })
      }

      // 尝试解析为数字
      const numValue = Number(value)
      await service.updateEnvironment(room.id, key, isNaN(numValue) ? value : numValue)

      const env = JSON.parse((await service.getRoom(room.id))?.environmentJson ?? '{}')

      return JSON.stringify({
        success: true,
        message: `已将 "${room.name}" 的 ${key} 调整为 ${value}`,
        current_environment: env,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `调整环境失败: ${errMsg}` })
    }
  },
}

// ─────────────────────────────────────────────
// stronghold_call_butler — 呼叫管家
// ─────────────────────────────────────────────

export const strongholdCallButlerTool: BuiltinTool = {
  definition: {
    name: 'stronghold_call_butler',
    description:
      '呼叫据点管家。管家可以帮你管理设施和房间，如打扫卫生、调整布局、维修设备等。' +
      '管家会根据请求自动执行相应操作。',
    parameters: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description: '对管家的请求或指示 (如 "把灯光调暗一点"、"帮我打扫卧室")',
        },
      },
      required: ['request'],
    },
  },

  async execute(args, ctx) {
    const service = requireService()
    if (typeof service === 'string') return service

    const request = args.request as string

    try {
      const butlerConfig = await service.getButlerConfig()

      if (!butlerConfig.enabled) {
        return JSON.stringify({
          error: '管家服务当前已关闭。',
        })
      }

      const room = await service.getAgentLocation(ctx.agentId)
      const roomName = room?.name ?? '(未知)'

      // 管家请求记录 — 实际处理由 GroupChatDispatcher 调度
      // 管家本身也是一个 Agent，请求会转为对管家 Agent 的一次 chat 调用
      logger.info(`[Butler] 收到来自 ${ctx.agentId} 的请求 (房间: ${roomName}): ${request}`)

      return JSON.stringify({
        success: true,
        message: `已呼叫管家。请求: "${request}"`,
        butler: butlerConfig.name,
        location: roomName,
        note: '管家会在后台处理你的请求。',
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return JSON.stringify({ error: `呼叫管家失败: ${errMsg}` })
    }
  },
}

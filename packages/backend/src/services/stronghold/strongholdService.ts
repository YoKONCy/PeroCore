/**
 * Stronghold Service — 据点管理服务
 *
 * 据点系统 的核心 CRUD 服务:
 * - Facility (设施) 管理
 * - Room (房间) 管理 (含环境变量)
 * - Agent 位置管理 (当前在哪个房间)
 * - Butler (管家) 配置
 * - 初始化确保默认数据存在
 *
 * 每个 Room 通过相同 ID 关联一个 GroupChatRoom。
 *
 * @module packages/backend/src/services/stronghold/strongholdService
 */

import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  strongholdFacilities,
  strongholdRooms,
  agentLocations,
  butlerConfigs,
  groupChatRooms,
  groupChatMembers,
} from '../../database/schema'
import type { DrizzleDb } from '../../database'
import { createLogger } from '../../lib/logger'
import { AppError } from '../../lib/appError'

const logger = createLogger('StrongholdService')

// ── 类型 ──

type FacilityRow = typeof strongholdFacilities.$inferSelect
type RoomRow = typeof strongholdRooms.$inferSelect
type LocationRow = typeof agentLocations.$inferSelect
type ButlerRow = typeof butlerConfigs.$inferSelect

export interface CreateFacilityInput {
  name: string
  description?: string
  icon?: string
}

export interface CreateRoomInput {
  facilityId: number
  name: string
  description?: string
  allowedAgents?: string[]
  environment?: Record<string, unknown>
}

// ── Service ──

export class StrongholdService {
  constructor(private db: DrizzleDb) {}

  // ─── 初始化 ───

  /**
   * 确保据点系统有默认数据 (启动时调用)
   *
   * 1. 默认设施 "我的据点"
   * 2. 默认房间 "客厅"
   * 3. 无房间的 Agent 归位到客厅
   */
  async ensureDefaults(agentIds: string[] = []): Promise<void> {
    logger.info('检查据点默认数据...')

    // 1. 确保默认设施
    let facility = await this.getFacilityByName('我的据点')
    if (!facility) {
      facility = await this.createFacility({
        name: '我的据点',
        description: '温馨的家',
        icon: 'HomeFilled',
      })
      logger.info('已创建默认设施: 我的据点')
    }

    // 2. 确保默认房间 (客厅)
    let livingRoom = await this.getRoomByName('客厅')
    if (!livingRoom) {
      livingRoom = await this.createRoom({
        facilityId: facility.id,
        name: '客厅',
        description: '宽敞明亮的公共区域，适合大家聚在一起。',
        environment: { 光照: 80, 温度: 24, 音乐: 'Relaxing Piano', 清洁度: 100 },
      })
      logger.info('已创建默认房间: 客厅')
    }

    for (const agentId of new Set(agentIds)) {
      await this.ensureAgentLocation(agentId, livingRoom.id)
    }

    logger.info('据点默认数据检查完成')
  }

  // ─── 设施管理 ───

  async createFacility(input: CreateFacilityInput): Promise<FacilityRow> {
    const rows = await this.db
      .insert(strongholdFacilities)
      .values({
        name: input.name,
        description: input.description,
        icon: input.icon,
      })
      .returning()
    return rows[0]!
  }

  async listFacilities(): Promise<FacilityRow[]> {
    return this.db.select().from(strongholdFacilities).all()
  }

  async getFacility(facilityId: number): Promise<FacilityRow | undefined> {
    return this.db
      .select()
      .from(strongholdFacilities)
      .where(eq(strongholdFacilities.id, facilityId))
      .get()
  }

  async getFacilityByName(name: string): Promise<FacilityRow | undefined> {
    return this.db
      .select()
      .from(strongholdFacilities)
      .where(eq(strongholdFacilities.name, name))
      .get()
  }

  // ─── 房间管理 ───

  /**
   * 创建房间 (同时创建关联的 GroupChatRoom + 默认成员)
   */
  async createRoom(input: CreateRoomInput): Promise<RoomRow> {
    const facility = await this.getFacility(input.facilityId)
    if (!facility) throw new AppError('NOT_FOUND', { message: `设施 ${input.facilityId} 不存在` })

    const roomId = uuidv4()
    const allowedAgents = input.allowedAgents ?? []

    // 1. 创建据点房间
    await this.db.insert(strongholdRooms).values({
      id: roomId,
      facilityId: input.facilityId,
      name: input.name,
      description: input.description,
      allowedAgentsJson: JSON.stringify(allowedAgents),
      environmentJson: JSON.stringify(input.environment ?? {}),
    })

    // 2. 创建关联的群聊房间
    await this.db.insert(groupChatRooms).values({
      id: roomId,
      name: input.name,
      description: input.description,
      creatorId: 'system',
    })

    // 3. 添加系统 + 用户为默认成员
    await this.db.insert(groupChatMembers).values([
      { roomId, agentId: 'system', role: 'admin' },
      { roomId, agentId: 'user', role: 'member' },
    ])

    // 4. 添加允许的 Agent
    if (allowedAgents.length > 0) {
      await this.db.insert(groupChatMembers).values(
        allowedAgents.map((agentId) => ({
          roomId,
          agentId,
          role: 'member' as const,
        })),
      )
    }

    const room = await this.db
      .select()
      .from(strongholdRooms)
      .where(eq(strongholdRooms.id, roomId))
      .get()
    return room!
  }

  async getRoom(roomId: string): Promise<RoomRow | undefined> {
    return this.db.select().from(strongholdRooms).where(eq(strongholdRooms.id, roomId)).get()
  }

  async getRoomByName(name: string): Promise<RoomRow | undefined> {
    return this.db.select().from(strongholdRooms).where(eq(strongholdRooms.name, name)).get()
  }

  async listRooms(facilityId?: number): Promise<RoomRow[]> {
    if (facilityId !== undefined) {
      return this.db
        .select()
        .from(strongholdRooms)
        .where(eq(strongholdRooms.facilityId, facilityId))
        .all()
    }
    return this.db.select().from(strongholdRooms).all()
  }

  async updateRoom(
    roomId: string,
    updates: Partial<
      Pick<RoomRow, 'name' | 'description' | 'allowedAgentsJson' | 'environmentJson'>
    >,
  ): Promise<RoomRow | undefined> {
    const rows = await this.db
      .update(strongholdRooms)
      .set(updates)
      .where(eq(strongholdRooms.id, roomId))
      .returning()
    return rows[0]
  }

  /**
   * 删除房间 (客厅不能删除)
   *
   * 房间内的 Agent 自动移到客厅。
   */
  async deleteRoom(roomId: string): Promise<void> {
    const room = await this.getRoom(roomId)
    if (!room) throw new AppError('NOT_FOUND', { message: `房间 ${roomId} 不存在` })
    if (room.name === '客厅') throw new AppError('CONFLICT', { message: '客厅不能被删除' })

    // 将该房间内的 Agent 移到客厅
    const livingRoom = await this.getRoomByName('客厅')
    if (livingRoom) {
      const agents = await this.getRoomAgents(roomId)
      for (const agentId of agents) {
        await this.moveAgent(agentId, livingRoom.id)
      }
    }

    // 删除据点房间
    await this.db.delete(strongholdRooms).where(eq(strongholdRooms.id, roomId))
    // 群聊房间保留 (允许查看历史消息)

    logger.info(`房间已删除: ${room.name}`)
  }

  // ─── 环境变量 ───

  async updateEnvironment(roomId: string, key: string, value: unknown): Promise<void> {
    const room = await this.getRoom(roomId)
    if (!room) throw new AppError('NOT_FOUND', { message: `房间 ${roomId} 不存在` })

    const env = JSON.parse(room.environmentJson ?? '{}') as Record<string, unknown>
    env[key] = value

    await this.db
      .update(strongholdRooms)
      .set({ environmentJson: JSON.stringify(env) })
      .where(eq(strongholdRooms.id, roomId))
  }

  // ─── Agent 位置 ───

  async ensureAgentLocation(agentId: string, livingRoomId?: string): Promise<LocationRow> {
    const existing = await this.db
      .select()
      .from(agentLocations)
      .where(eq(agentLocations.agentId, agentId))
      .get()
    if (existing) {
      await this.ensureRoomMember(existing.roomId, agentId)
      return existing
    }

    const livingRoom = livingRoomId
      ? await this.getRoom(livingRoomId)
      : await this.getRoomByName('客厅')
    if (!livingRoom) throw new AppError('PRECONDITION_FAILED', { message: '客厅尚未初始化' })
    return this.moveAgent(agentId, livingRoom.id)
  }

  private async ensureRoomMember(roomId: string, agentId: string): Promise<void> {
    const members = await this.db
      .select()
      .from(groupChatMembers)
      .where(eq(groupChatMembers.roomId, roomId))
      .all()
    if (!members.some((member) => member.agentId === agentId)) {
      await this.db.insert(groupChatMembers).values({ roomId, agentId, role: 'member' })
    }
  }

  async moveAgent(agentId: string, roomId: string): Promise<LocationRow> {
    const room = await this.getRoom(roomId)
    if (!room) throw new AppError('NOT_FOUND', { message: `房间 ${roomId} 不存在` })

    // Upsert
    const existing = await this.db
      .select()
      .from(agentLocations)
      .where(eq(agentLocations.agentId, agentId))
      .get()

    if (existing) {
      await this.db
        .update(agentLocations)
        .set({
          roomId,
          updatedAt: sql`(datetime('now', 'localtime'))`,
        })
        .where(eq(agentLocations.agentId, agentId))

      // 角色只能位于一个房间：同步移除旧房间群聊成员，避免调度离场角色。
      if (existing.roomId !== roomId) {
        const oldMembers = await this.db
          .select()
          .from(groupChatMembers)
          .where(eq(groupChatMembers.roomId, existing.roomId))
          .all()
        const oldMembership = oldMembers.find((member) => member.agentId === agentId)
        if (oldMembership) {
          await this.db.delete(groupChatMembers).where(eq(groupChatMembers.id, oldMembership.id))
        }
      }
    } else {
      await this.db.insert(agentLocations).values({ agentId, roomId })
    }

    const location = await this.db
      .select()
      .from(agentLocations)
      .where(eq(agentLocations.agentId, agentId))
      .get()

    await this.ensureRoomMember(roomId, agentId)

    logger.debug(`Agent ${agentId} 移动到房间 ${room.name}`)
    return location!
  }

  async getAgentLocation(agentId: string): Promise<RoomRow | undefined> {
    const location = await this.db
      .select()
      .from(agentLocations)
      .where(eq(agentLocations.agentId, agentId))
      .get()

    if (!location) return undefined
    return this.getRoom(location.roomId)
  }

  async getRoomAgents(roomId: string): Promise<string[]> {
    const locations = await this.db
      .select({ agentId: agentLocations.agentId })
      .from(agentLocations)
      .where(eq(agentLocations.roomId, roomId))
      .all()
    return locations.map((l) => l.agentId)
  }

  // ─── 管家配置 ───

  async getButlerConfig(): Promise<ButlerRow> {
    let config = await this.db.select().from(butlerConfigs).get()

    if (!config) {
      const rows = await this.db
        .insert(butlerConfigs)
        .values({
          name: 'Butler',
          persona: '你是据点的 AI 管家，负责管理设施和房间。',
          enabled: true,
        })
        .returning()
      config = rows[0]!
    }

    return config
  }

  async updateButlerEnabled(enabled: boolean): Promise<void> {
    const config = await this.getButlerConfig()
    await this.db.update(butlerConfigs).set({ enabled }).where(eq(butlerConfigs.id, config.id))
  }
}

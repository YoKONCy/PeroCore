import { describe, expect, it } from 'vitest'
import { ApprovalService } from '@infos/backend/services/execution/approvalService'
import { PolicyEngine } from '@infos/backend/services/execution/policyEngine'
import type { ToolPermission } from '@infos/backend/capabilities/types'

const base = {
  agentId: 'pero',
  channel: 'desktop',
  sessionId: 'thread-1',
  threadId: 'thread-1',
  toolName: 'terminal_execute',
  args: { command: 'pnpm test' },
}

const approvalPermission: ToolPermission = {
  toolName: 'terminal_execute',
  resourceScope: { scope: 'system', allowedRoots: [], deniedPaths: [] },
  requiresApproval: true,
}

describe('PolicyEngine', () => {
  it('执行参数长度、命令白名单与禁止模式', () => {
    const engine = new PolicyEngine()
    expect(
      engine.evaluate({
        ...base,
        permission: {
          ...approvalPermission,
          requiresApproval: false,
          paramPolicy: { maxContentLength: 3 },
        },
      }).action,
    ).toBe('deny')
    expect(
      engine.evaluate({
        ...base,
        permission: {
          ...approvalPermission,
          requiresApproval: false,
          paramPolicy: { allowedCommands: ['git'] },
        },
      }),
    ).toMatchObject({ action: 'deny', code: 'COMMAND_NOT_ALLOWED' })
    expect(
      engine.evaluate({
        ...base,
        permission: {
          ...approvalPermission,
          requiresApproval: false,
          paramPolicy: { deniedPatterns: ['pnpm\\s+test'] },
        },
      }),
    ).toMatchObject({ action: 'deny', code: 'PARAM_PATTERN_DENIED' })
  })

  it('高风险命令即使未显式配置也要求审批', () => {
    const engine = new PolicyEngine()
    const result = engine.evaluate({ ...base, args: { command: 'git reset --hard' } })
    expect(result.action).toBe('require_approval')
  })
})

describe('ApprovalService', () => {
  it('allow_once 只允许相同参数消费一次', () => {
    const service = new ApprovalService()
    const request = service.create({ ...base, reason: '需要审批' })
    service.resolve(request.id, 'allow_once')
    expect(service.authorize({ ...base, approvalId: request.id })).toBe('allow')
    expect(service.get(request.id)?.status).toBe('consumed')
    expect(service.authorize({ ...base, approvalId: request.id })).toBe('none')
  })

  it('allow_session 允许同会话后续调用，并可清理', () => {
    const service = new ApprovalService()
    const request = service.create({ ...base, reason: '需要审批' })
    service.resolve(request.id, 'allow_session')
    expect(service.authorize(base)).toBe('allow')
    service.clearSession(base.sessionId)
    expect(service.authorize(base)).toBe('none')
  })

  it('对敏感参数脱敏并复用相同 pending 请求', () => {
    const service = new ApprovalService()
    const input = { ...base, args: { command: 'echo ok', password: 'secret' }, reason: '需要审批' }
    const first = service.create(input)
    const second = service.create(input)
    expect(second.id).toBe(first.id)
    expect(first.argsSummary.password).toBe('[已隐藏]')
  })

  it('递归脱敏嵌套凭据并等待审批决策', async () => {
    const service = new ApprovalService()
    const request = service.create({
      ...base,
      args: {
        headers: { Authorization: 'Bearer top-secret', Cookie: 'sid=secret' },
        items: [{ apiKey: 'sk-abcdefghijklmnop' }],
      },
      reason: '需要审批',
    })
    expect(request.argsSummary).toMatchObject({
      headers: { Authorization: '[已隐藏]', Cookie: '[已隐藏]' },
      items: [{ apiKey: '[已隐藏]' }],
    })
    const waiting = service.waitForResolution(request.id)
    service.resolve(request.id, 'allow_once', '仅执行这一次')
    await expect(waiting).resolves.toMatchObject({
      status: 'approved',
      decision: 'allow_once',
      resolutionMessage: '仅执行这一次',
    })
  })
})

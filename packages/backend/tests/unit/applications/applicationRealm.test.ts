import { describe, expect, it, vi } from 'vitest'
import { ApplicationRealmManager } from '../../../src/applications/applicationRealm'
import { ToolRegistry } from '../../../src/services/agent/toolRegistry'

describe('ApplicationRealmManager', () => {
  it('必须拒绝将Stronghold注册为Application Realm', () => {
    const manager = new ApplicationRealmManager(new ToolRegistry())
    expect(() =>
      manager.register({
        realmId: 'infos.stronghold',
        appId: 'infos.stronghold',
        principalId: 'application:infos.stronghold',
        instanceId: 'test',
      }),
    ).toThrow('STRONGHOLD_REALM_FORBIDDEN')
  })

  it('Realm工具只对所属Realm可见并随Realm销毁', async () => {
    const tools = new ToolRegistry()
    const manager = new ApplicationRealmManager(tools)
    const realm = manager.register({
      realmId: 'infos.arca',
      appId: 'infos.arca',
      principalId: 'application:infos.arca',
      instanceId: 'managed',
    })
    realm.registerTool(
      {
        name: 'arca_changeset_propose',
        description: '提交ChangeSet',
        parameters: { type: 'object', properties: {} },
      },
      vi.fn(async () => 'ok'),
    )

    expect(manager.allowsTool('infos.arca', 'arca_changeset_propose')).toBe(true)
    expect(manager.allowsTool(undefined, 'arca_changeset_propose')).toBe(false)
    expect(manager.toolDefinitions('infos.arca').map((tool) => tool.name)).toEqual([
      'arca_changeset_propose',
    ])

    await realm.dispose()
    expect(tools.has('arca_changeset_propose')).toBe(false)
    expect(manager.get('infos.arca')).toBeUndefined()
  })

  it('应支持单独注销并重新注册Realm工具', async () => {
    const tools = new ToolRegistry()
    const manager = new ApplicationRealmManager(tools)
    const realm = manager.register({
      realmId: 'infos.arca',
      appId: 'infos.arca',
      principalId: 'application:infos.arca',
      instanceId: 'managed',
    })
    const definition = {
      name: 'arca_document_inspect',
      description: '读取文档',
      parameters: { type: 'object', properties: {} },
    }

    realm.registerTool(definition, async () => 'first', { hostProjection: true })
    expect(manager.isHostProjection(definition.name)).toBe(true)
    expect(manager.isPrivateTool(definition.name)).toBe(false)
    expect(manager.allowsTool(undefined, definition.name)).toBe(true)
    await expect(realm.unregisterTool(definition.name)).resolves.toBe(true)
    expect(tools.has(definition.name)).toBe(false)
    expect(manager.ownsTool(definition.name)).toBe(false)
    expect(manager.isHostProjection(definition.name)).toBe(false)

    realm.registerTool(definition, async () => 'second', { hostProjection: true })
    expect(tools.has(definition.name)).toBe(true)
    await realm.dispose()
    expect(tools.has(definition.name)).toBe(false)
  })

  it('不得覆盖主应用已有工具', () => {
    const tools = new ToolRegistry()
    tools.register(
      { name: 'main_tool', description: '主应用工具', parameters: { type: 'object' } },
      async () => 'main',
    )
    const manager = new ApplicationRealmManager(tools)
    const realm = manager.register({
      realmId: 'infos.arca',
      appId: 'infos.arca',
      principalId: 'application:infos.arca',
      instanceId: 'managed',
    })
    expect(() =>
      realm.registerTool(
        { name: 'main_tool', description: '覆盖工具', parameters: { type: 'object' } },
        async () => 'realm',
      ),
    ).toThrow('APPLICATION_REALM_TOOL_CONFLICT')
  })

  it('不同Realm不得注册同名工具', () => {
    const manager = new ApplicationRealmManager(new ToolRegistry())
    const first = manager.register({
      realmId: 'infos.arca',
      appId: 'infos.arca',
      principalId: 'application:infos.arca',
      instanceId: 'one',
    })
    const second = manager.register({
      realmId: 'infos.social',
      appId: 'infos.social',
      principalId: 'application:infos.social',
      instanceId: 'two',
    })
    const definition = {
      name: 'shared_name',
      description: '冲突工具',
      parameters: { type: 'object', properties: {} },
    }
    first.registerTool(definition, async () => 'one')
    expect(() => second.registerTool(definition, async () => 'two')).toThrow(
      'APPLICATION_REALM_TOOL_CONFLICT',
    )
  })
})

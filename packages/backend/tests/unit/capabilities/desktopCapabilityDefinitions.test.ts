import { describe, expect, it, vi } from 'vitest'
import type { KernelObjectId } from '@infos/shared'
import { CapabilityDirectory, CapabilityHandleRegistry } from '@infos/backend/kernel'
import { DESKTOP_ENVIRONMENT_CAPABILITY } from '@infos/backend/capabilities/nativeCapabilityDefinitions'

describe('桌面原生Capability合同', () => {
  it('应允许Electron声明applicationLaunch操作', () => {
    const directory = new CapabilityDirectory(new CapabilityHandleRegistry())
    directory.registerDefinition(DESKTOP_ENVIRONMENT_CAPABILITY)

    expect(() =>
      directory.registerRemoteProvider(
        {
          offerId: 'electron.desktop-environment@test',
          provider: {
            objectType: 'capability-provider',
            objectId: 'electron.desktop/provider' as KernelObjectId,
            generation: 1,
            ownerPrincipalId: 'electron-client',
            authorityNodeId: 'electron:test' as never,
            authorityEpoch: 1,
          },
          capabilityType: 'desktop.environment',
          contractVersion: '1.0',
          operations: ['applicationLaunch'],
          resourceKinds: ['application'],
          health: 'available',
          placement: {
            providerNodeId: 'electron:test' as never,
            providerFacet: 'capability',
            executionLocation: 'client-local',
            requiresClientPresence: true,
            requiresInputSeat: true,
            supportsHeadless: false,
            dataResidency: 'device-only',
            latencyClass: 'local',
            costClass: 'free',
          },
        },
        vi.fn(),
      ),
    ).not.toThrow()
  })
})

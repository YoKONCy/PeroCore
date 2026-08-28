import type { KernelNodeId, KernelObjectId } from '@infos/shared'
import {
  createNodeAssetPayload,
  verifyNodeAssetPayload,
  type NodeAssetPayload,
  type NodeProvider,
} from '@infos/node-sdk'

export function createEchoAssetProvider(nodeId: KernelNodeId): NodeProvider {
  return {
    manifest: {
      manifestVersion: 1,
      providerId: 'infos.probe.echo-asset',
      name: 'Echo 与 Asset 完整性探针',
      version: '1.0.0',
      definition: {
        capabilityType: 'probe.echo-asset',
        contractVersion: '1.0',
        operations: {
          echo: { risk: 'read', idempotency: 'safe' },
          delay: { risk: 'read', idempotency: 'keyed' },
          transformAsset: { risk: 'interact', idempotency: 'keyed' },
        },
      },
      offer: {
        offerId: `infos.probe.echo-asset@1.0:${nodeId}`,
        capabilityType: 'probe.echo-asset',
        contractVersion: '1.0',
        operations: ['echo', 'delay', 'transformAsset'],
        resourceKinds: ['probe', 'asset-payload'],
      },
    },
    health: () => 'available',
    async invoke(envelope, context) {
      const input = envelope.payload.input as Record<string, unknown>
      switch (envelope.payload.operation) {
        case 'echo':
          return {
            echo: input,
            nodeId: context.node.nodeId,
            invocationId: context.invocationId,
          }
        case 'delay': {
          const durationMs = Math.max(0, Math.min(30_000, Number(input.durationMs ?? 0)))
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, durationMs)
            context.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(new Error('NODE_INVOCATION_CANCELLED'))
              },
              { once: true },
            )
          })
          return { delayedMs: durationMs }
        }
        case 'transformAsset': {
          const payload = input.asset as NodeAssetPayload
          const bytes = verifyNodeAssetPayload(payload)
          const transformed = Buffer.from(bytes.toString('utf8').toUpperCase(), 'utf8')
          return {
            asset: createNodeAssetPayload({
              assetId: `${payload.assetId}:uppercase`,
              mimeType: payload.mimeType,
              bytes: transformed,
            }),
            source: {
              objectType: 'probe-asset',
              objectId: payload.assetId as KernelObjectId,
              generation: 1,
              ownerPrincipalId: envelope.principalId,
              authorityNodeId: nodeId,
              authorityEpoch: 1,
            },
          }
        }
        default:
          throw new Error(`NODE_OPERATION_UNSUPPORTED: ${envelope.payload.operation}`)
      }
    },
  }
}

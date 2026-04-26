/**
 * Dashboard Gateway 薄封装
 *
 * Dashboard 侧沿用 onPush/offPush API，底层连接逻辑统一复用通用 Gateway composable。
 *
 * @module packages/frontend/src/composables/dashboard/useGateway
 */
import { onMounted } from 'vue'
import { useGateway as useCoreGateway } from '../gateway/useGateway'

export function useGateway() {
  const gateway = useCoreGateway()

  onMounted(gateway.connect)

  return {
    isConnected: gateway.isConnected,
    lastError: gateway.lastError,
    onPush: gateway.onPush,
    offPush: gateway.offPush,
    disconnect: gateway.disconnect,
    reconnect: gateway.reconnect,
  }
}

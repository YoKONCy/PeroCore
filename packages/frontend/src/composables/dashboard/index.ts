// Dashboard composables 统一导出
export { useModelConfig } from './useModelConfig'
export { useGateway } from './useGateway'
export {
  createDashboardContext,
  useDashboardContext,
  DASHBOARD_CTX_KEY,
} from './useDashboardContext'
export type {
  OpenConfirmFn,
  ConfirmOptions,
  ConfirmResult,
  DashboardContext,
} from './useDashboardContext'

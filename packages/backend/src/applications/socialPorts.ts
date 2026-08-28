/**
 * socialPorts — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
export type {
  SocialContactImpressionRecord,
  SocialEventPort,
  SocialExecutionPort,
  SocialMessageRecord,
  SocialStoragePort,
  SocialSyncCursorRecord,
} from '@infos/shared'

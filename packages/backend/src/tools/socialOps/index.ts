/**
 * 社交工具已迁移到 packages/apps/social/tools/
 * 此文件仅保留 notify_owner 工具的 re-export（主 Agent 内核使用）。
 *
 * @deprecated 大部分工具已迁移到社交独立应用
 */
export {
  socialNotifyOwnerTool,
  setSocialMessagingProvider,
  type SocialMessagingProvider,
  type SocialContact,
  type SocialGroup,
} from './notifyOwner'

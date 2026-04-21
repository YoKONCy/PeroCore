/**
 * 社交模式 NIT 工具 — 已迁移
 *
 * 社交工具已迁移到 tools/socialOps/ 模块:
 * - socialOps/index.ts  → 8 个平台无关工具 + SocialMessagingProvider 接口
 * - socialOps/manifest.json → 工具元数据
 *
 * 工具通过 SocialMessagingProvider 抽象接口解耦，
 * Provider 由 container.ts 从 SocialBridge.createMessagingProvider() 注入。
 *
 * @module packages/backend/src/services/social/tools
 * @see packages/backend/src/tools/socialOps/index.ts
 */

// 此文件保留为占位，避免其他模块引用时报错。
// 实际工具实现在 tools/socialOps/ 下。

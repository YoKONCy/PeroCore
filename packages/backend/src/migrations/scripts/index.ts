import type { DataMigration } from '../migrationTypes'

/**
 * 数据迁移注册表。
 *
 * 新迁移必须追加，不能修改或删除已经正式发布的迁移；管理器会按 ID 排序执行。
 * 当前预发布阶段的一次性迁移（Principal 目录、social_contact_impressions.identity 补列）
 * 均已在本地完成，因此不注册历史脚本。
 */
export const dataMigrations: readonly DataMigration[] = []

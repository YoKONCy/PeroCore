/**
 * Drizzle Kit 配置
 *
 * 用于生成和管理数据库迁移。
 *
 * @module packages/backend/drizzle.config
 */

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/database/schema.ts',
  out: './src/database/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.PERO_DATABASE_PATH ?? './data/perocore.db',
  },
})

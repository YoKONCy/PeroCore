/**
 * useConfigStore — 全局配置状态
 *
 * @see 05_FRONTEND_ARCHITECTURE.md §4.1
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { configApi } from '../api/modules/configApi'

export const useConfigStore = defineStore('config', () => {
  // ── 状态 ──
  /** 配置缓存 (key → value) */
  const cache = ref<Record<string, unknown>>({})
  const isLoading = ref(false)

  // ── 动作 ──

  /** 获取单个配置 (先查缓存) */
  async function getConfig<T = unknown>(key: string, forceRefresh = false): Promise<T | undefined> {
    if (!forceRefresh && key in cache.value) {
      return cache.value[key] as T
    }

    try {
      const res = await configApi.get<T>(key)
      cache.value[key] = res.data
      return res.data as T
    } catch {
      return undefined
    }
  }

  /** 设置配置 */
  async function setConfig(key: string, value: unknown): Promise<boolean> {
    try {
      await configApi.set(key, value)
      cache.value[key] = value
      return true
    } catch {
      return false
    }
  }

  /** 批量加载配置 */
  async function loadBatch(keys: string[]) {
    isLoading.value = true
    try {
      const res = await configApi.batch(keys)
      if (res.data) {
        Object.assign(cache.value, res.data)
      }
    } finally {
      isLoading.value = false
    }
  }

  /** 清除缓存 */
  function clearCache() {
    cache.value = {}
  }

  return {
    cache,
    isLoading,
    getConfig,
    setConfig,
    loadBatch,
    clearCache,
  }
})

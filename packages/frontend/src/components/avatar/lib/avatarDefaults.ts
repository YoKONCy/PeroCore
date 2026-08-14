/**
 * 看板娘模型全局默认配置
 *
 * 所有默认加载、初始化和失败兜底都统一引用这里，避免不同入口各自硬编码模型。
 */

/** 默认看板娘：蓝色大肥鱼（DeepSeek酱） */
export const DEFAULT_AVATAR_NAME = 'DeepSeek酱'

/** 默认模型标准清单 */
export const DEFAULT_AVATAR_MANIFEST_PATH = '/assets/3d/DeepSeek%E9%85%B1/manifest.json'

/** manifest 不可用时，直接通过 YSM 配置运行时生成清单 */
export const DEFAULT_AVATAR_YSM_PATH = '/assets/3d/DeepSeek%E9%85%B1/ysm.json'

/** 模型选择持久化键 */
export const AVATAR_MODEL_STORAGE_KEY = 'ppc.avatar_model_manifest'

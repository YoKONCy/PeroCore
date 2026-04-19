/**
 * @perocore/render-core — TS Mock 实现
 *
 * 资产加密/反调/打包模块，仅 Electron 版使用。
 * Docker 版不依赖此模块。
 * 开发期使用此 TS fallback（不加密，直接返回原始数据）。
 *
 * @module @perocore/render-core
 */

/**
 * 加密资产数据
 *
 * @param data 原始数据
 * @param key 加密密钥
 * @returns 加密后的数据
 */
export function encrypt(data: Buffer, _key: string): Buffer {
  // TS mock: 不加密，直接返回
  console.warn('[render-core] encrypt: TS mock，未加密')
  return data
}

/**
 * 解密资产数据
 *
 * @param data 加密数据
 * @param key 解密密钥
 * @returns 原始数据
 */
export function decrypt(data: Buffer, _key: string): Buffer {
  // TS mock: 不解密，直接返回
  console.warn('[render-core] decrypt: TS mock，未解密')
  return data
}

/**
 * 验证资产完整性
 *
 * @param data 资产数据
 * @param hash 预期哈希
 * @returns 是否完整
 */
export function verifyIntegrity(_data: Buffer, _hash: string): boolean {
  // TS mock: 总是返回 true
  console.warn('[render-core] verifyIntegrity: TS mock，跳过校验')
  return true
}

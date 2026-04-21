/**
 * 模型适配器工厂
 *
 * 管理已注册的模型适配器，根据模型路径自动匹配合适的适配器。
 *
 * @module packages/frontend/src/components/avatar/lib/adapter/ModelAdapterFactory
 */

import type { IModelAdapter } from './IModelAdapter'

/**
 * 模型适配器工厂
 *
 * 通过 `registerAdapter()` 注册适配器，
 * `getAdapter()` 根据模型路径返回第一个匹配的适配器。
 */
export class ModelAdapterFactory {
  private static adapters: IModelAdapter[] = []

  /**
   * 根据模型路径获取匹配的适配器
   *
   * @param modelPath - 模型文件路径
   * @returns 匹配的适配器，无匹配时返回 null
   */
  static getAdapter(modelPath: string): IModelAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(modelPath)) {
        return adapter
      }
    }
    return null
  }

  /**
   * 注册模型适配器
   *
   * @param adapter - 要注册的适配器实例
   */
  static registerAdapter(adapter: IModelAdapter): void {
    this.adapters.push(adapter)
  }
}

import type { PackageManifest } from '@infos/shared'
import type { InstalledPackage, PackageState } from './types'

/** Package 安装态与激活态注册表，不持有运行时实现实例。 */
export class PackageRegistry {
  private readonly packages = new Map<string, InstalledPackage>()

  install(manifest: PackageManifest, rootDir?: string): InstalledPackage {
    if (this.packages.has(manifest.packageId))
      throw new Error(`Package 已安装: ${manifest.packageId}`)
    const installed: InstalledPackage = {
      manifest: Object.freeze({ ...manifest, contributions: [...manifest.contributions] }),
      rootDir,
      state: 'installed',
      installedAt: new Date().toISOString(),
    }
    this.packages.set(manifest.packageId, installed)
    return installed
  }

  replace(manifest: PackageManifest, rootDir?: string): InstalledPackage {
    const current = this.packages.get(manifest.packageId)
    if (current?.state === 'active' || current?.state === 'activating') {
      throw new Error(`Package 激活期间不能替换: ${manifest.packageId}`)
    }
    this.packages.delete(manifest.packageId)
    return this.install(manifest, rootDir)
  }

  uninstall(packageId: string): boolean {
    const current = this.packages.get(packageId)
    if (!current) return false
    if (current.state === 'active' || current.state === 'activating') {
      throw new Error(`Package 必须停用后卸载: ${packageId}`)
    }
    return this.packages.delete(packageId)
  }

  get(packageId: string): InstalledPackage | undefined {
    return this.packages.get(packageId)
  }

  list(): InstalledPackage[] {
    return [...this.packages.values()]
  }

  setState(packageId: string, state: PackageState, error?: string): InstalledPackage {
    const current = this.packages.get(packageId)
    if (!current) throw new Error(`Package 未安装: ${packageId}`)
    current.state = state
    current.error = error
    if (state === 'active') current.activatedAt = new Date().toISOString()
    if (state === 'inactive') current.activatedAt = undefined
    return current
  }
}

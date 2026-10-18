/** 发行脚本使用的清单依赖字段。 */
export interface DependencyManifest {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

/** 将清单依赖分类为必需与可选条目；同名项由可选依赖覆盖。 */
export function classifyManifestDependencies(
  manifest: DependencyManifest,
): Array<{ name: string; optional: boolean }>

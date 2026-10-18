import type { Binding, BindingPath } from './domain'

/** 数组组装仍使用声明式引用，不执行表达式或隐式转换。 */
export function bindingLeaves(
  binding: Binding,
): Array<Exclude<Binding, { array: Binding[] } | { select: Binding }>> {
  return 'array' in binding
    ? binding.array.flatMap(bindingLeaves)
    : 'select' in binding
      ? bindingLeaves(binding.select)
      : [binding]
}
export function dependencies(bindings: Record<string, Binding>): string[] {
  return [
    ...new Set(
      Object.values(bindings)
        .flatMap(bindingLeaves)
        .flatMap((binding) => ('node' in binding ? [binding.node] : [])),
    ),
  ]
}
export function selectPath(value: unknown, path: BindingPath = []): unknown {
  let result = value
  for (const key of path) {
    if (
      ['__proto__', 'constructor', 'prototype'].includes(String(key)) ||
      !result ||
      typeof result !== 'object' ||
      !Object.hasOwn(result, key)
    )
      throw new Error(`引用字段不存在：${path.join('.')}`)
    result = (result as Record<string | number, unknown>)[key]
  }
  return result
}
export function withPath(binding: Binding, path: BindingPath = []): Binding {
  if (!path.length) return binding
  if ('literal' in binding) return { literal: selectPath(binding.literal, path) }
  if ('array' in binding) {
    return { select: binding, path }
  }
  return { ...binding, path: [...(binding.path || []), ...path] }
}

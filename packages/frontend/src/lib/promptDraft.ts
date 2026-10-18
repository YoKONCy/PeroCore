import type { PromptBundle, PromptFramework } from '@infos/shared'

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
function strings(value: unknown): value is Record<string, string> {
  return object(value) && Object.values(value).every((item) => typeof item === 'string')
}
function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}
function stConfiguration(value: unknown): boolean {
  if (!object(value) || !strings(value.markerBindings) || !strings(value.values)) return false
  if (value.utility !== undefined && !strings(value.utility)) return false
  if (
    value.characters !== undefined &&
    (!object(value.characters) ||
      Object.entries(value.characters).some(
        ([key, item]) => ['__proto__', 'constructor', 'prototype'].includes(key) || !strings(item),
      ))
  )
    return false
  return (
    (value.sourcePreset === undefined || object(value.sourcePreset)) &&
    (value.orderProfile === undefined ||
      (Number.isInteger(value.orderProfile) && Number(value.orderProfile) >= 0))
  )
}

/** 进入可视编辑器前检查结构，完整约束仍由后端发布校验负责。 */
export function isPromptFramework(value: unknown): value is PromptFramework {
  if (!object(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return false
  if (
    value.format !== undefined &&
    !['infos', 'sillytavern', 'custom'].includes(String(value.format))
  )
    return false
  if (value.sillyTavern !== undefined && !stConfiguration(value.sillyTavern)) return false
  if (value.overrides !== undefined && !strings(value.overrides)) return false
  if (!Array.isArray(value.bindings) || !Array.isArray(value.blocks)) return false
  return (
    value.bindings.every(
      (binding) =>
        object(binding) &&
        typeof binding.name === 'string' &&
        ['template', 'capabilities', 'persona'].includes(String(binding.kind)) &&
        optionalString(binding.source) &&
        optionalString(binding.template) &&
        optionalString(binding.when),
    ) &&
    value.blocks.every(
      (block) =>
        object(block) &&
        typeof block.id === 'string' &&
        typeof block.name === 'string' &&
        ['template', 'history', 'marker'].includes(String(block.kind)) &&
        ['system', 'user', 'assistant'].includes(String(block.role)) &&
        typeof block.enabled === 'boolean' &&
        optionalString(block.source) &&
        optionalString(block.template) &&
        optionalString(block.when) &&
        optionalString(block.marker) &&
        optionalString(block.stIdentifier) &&
        (block.position === undefined ||
          ['relative', 'in_chat'].includes(String(block.position))) &&
        (block.depth === undefined ||
          (Number.isInteger(block.depth) && Number(block.depth) >= 0)) &&
        (block.order === undefined || Number.isInteger(block.order)) &&
        (block.forbidOverrides === undefined || typeof block.forbidOverrides === 'boolean') &&
        (block.triggers === undefined ||
          (Array.isArray(block.triggers) &&
            block.triggers.every((trigger) => typeof trigger === 'string'))),
    )
  )
}

export function isPromptBundle(value: unknown): value is PromptBundle {
  if (
    !object(value) ||
    !Array.isArray(value.documents) ||
    !Array.isArray(value.frameworks) ||
    !Array.isArray(value.assignments)
  )
    return false
  return (
    value.documents.every(
      (doc) =>
        object(doc) &&
        typeof doc.id === 'string' &&
        typeof doc.name === 'string' &&
        typeof doc.body === 'string' &&
        ['slot', 'component', 'task'].includes(String(doc.kind)) &&
        ['system', 'user', 'assistant'].includes(String(doc.role)) &&
        typeof doc.enabled === 'boolean' &&
        Array.isArray(doc.variables) &&
        doc.variables.every((name) => typeof name === 'string'),
    ) &&
    value.frameworks.every(isPromptFramework) &&
    value.assignments.every(
      (scope) =>
        object(scope) &&
        typeof scope.agentId === 'string' &&
        typeof scope.channel === 'string' &&
        typeof scope.frameworkId === 'string' &&
        strings(scope.overrides),
    )
  )
}

/**
 * browserFormPlanner — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type {
  WebActionIntent,
  WebInteractionScene,
  WebSceneObject,
  WebSideEffectClass,
} from '@infos/shared'

export interface BrowserFormPlanStep {
  operation: 'setValue' | 'selectOption' | 'check' | 'uploadFile' | 'nativeClick'
  objectId: string
  handleId: string
  input: Record<string, unknown>
}

export interface BrowserFormPlan {
  planId: string
  sceneId: string
  formObjectId: string
  steps: BrowserFormPlanStep[]
  submitIntent: WebActionIntent
}

/** 从 InteractionScene 生成确定性表单计划，不接受任意 Selector。 */
export class BrowserFormPlanner {
  plan(input: {
    scene: WebInteractionScene
    formName?: string
    values: Record<string, unknown>
    intentSummary: string
    resourceSummary?: string
  }): BrowserFormPlan {
    if (input.scene.blockers.length) {
      throw new Error(`WEB_PLAN_BLOCKED: ${input.scene.blockers.join('；')}`)
    }
    const forms = input.scene.objects.filter((object) => object.kind === 'form')
    const form = input.formName
      ? forms.find((candidate) => candidate.name === input.formName)
      : forms[0]
    if (!form) throw new Error('WEB_FORM_NOT_FOUND: 当前 Scene 没有可用表单')
    const related = input.scene.objects.filter((object) => object.parentObjectId === form.objectId)
    const steps: BrowserFormPlanStep[] = []
    for (const [name, value] of Object.entries(input.values)) {
      const field = this.uniqueByName(related, name, 'field')
      if (!field.handle) throw new Error(`WEB_FIELD_HANDLE_MISSING: ${name}`)
      const affordance = field.affordances.find((item) => item.enabled)
      if (!affordance) throw new Error(`WEB_FIELD_DISABLED: ${name}`)
      const operation =
        affordance.operation === 'select'
          ? 'selectOption'
          : affordance.operation === 'check'
            ? 'check'
            : affordance.operation === 'upload'
              ? 'uploadFile'
              : 'setValue'
      steps.push({
        operation,
        objectId: field.objectId,
        handleId: field.handle.handleId,
        input:
          operation === 'check'
            ? { checked: Boolean(value) }
            : operation === 'uploadFile'
              ? { fileHandleId: String(value) }
              : { value: String(value) },
      })
    }
    const submit = related.find(
      (object) =>
        object.kind === 'button' &&
        object.affordances.some((affordance) => affordance.operation === 'submit'),
    )
    if (!submit?.handle) throw new Error('WEB_SUBMIT_NOT_FOUND: 表单没有可提交对象')
    steps.push({
      operation: 'nativeClick',
      objectId: submit.objectId,
      handleId: submit.handle.handleId,
      input: {},
    })
    return {
      planId: `form-plan:${input.scene.sceneId}:${form.objectId}`,
      sceneId: input.scene.sceneId,
      formObjectId: form.objectId,
      steps,
      submitIntent: {
        summary: input.intentSummary,
        targetObjectId: submit.objectId,
        origin: new URL(input.scene.url).origin,
        sideEffect: this.maxRisk(submit),
        resourceSummary: input.resourceSummary,
        reversible: false,
        expectedEffects: [
          { kind: 'url', required: false },
          { kind: 'structure', required: false },
          { kind: 'network', required: false },
          { kind: 'dialog', required: false },
          { kind: 'download', required: false },
        ],
      },
    }
  }

  private uniqueByName(
    objects: WebSceneObject[],
    name: string,
    kind: WebSceneObject['kind'],
  ): WebSceneObject {
    const matches = objects.filter(
      (object) =>
        object.kind === kind && object.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )
    if (matches.length !== 1) {
      throw new Error(`WEB_FIELD_AMBIGUOUS: ${name} 匹配 ${matches.length} 个字段`)
    }
    return matches[0]!
  }

  private maxRisk(object: WebSceneObject): WebSideEffectClass {
    const order: WebSideEffectClass[] = [
      'read',
      'local-change',
      'external-change',
      'commit',
      'irreversible',
    ]
    return object.affordances.reduce<WebSideEffectClass>(
      (result, affordance) =>
        order.indexOf(affordance.risk) > order.indexOf(result) ? affordance.risk : result,
      'read',
    )
  }
}

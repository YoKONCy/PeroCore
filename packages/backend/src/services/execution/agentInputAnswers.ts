import { z } from 'zod'
import {
  getAgentInputQuestions,
  type AgentInputAnswer,
  type AgentInputQuestion,
} from '@infos/shared'
import { AppError } from '../../lib/appError'

const identifier = z.string().trim().min(1).max(80)
const optionSchema = z.object({
  id: identifier,
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
})
const questionsSchema = z
  .array(
    z.object({
      id: identifier,
      question: z.string().trim().min(1).max(2000),
      context: z.string().trim().max(2000).optional(),
      options: z.array(optionSchema).max(4).default([]),
      multiple: z.boolean().default(false),
    }),
  )
  .min(1)
  .max(8)
const answersSchema = z
  .array(
    z
      .object({
        questionId: identifier,
        selectedOptionIds: z.array(identifier).max(4).default([]),
        message: z.string().trim().max(4000).optional(),
      })
      .strict(),
  )
  .min(1)
  .max(8)

export function normalizeAgentInputQuestions(value: unknown): AgentInputQuestion[] {
  const parsed = questionsSchema.safeParse(value)
  if (!parsed.success)
    throw new AppError('VALIDATION_ERROR', { message: '请提供一至八个有效问题，每题最多四个选项' })
  const ids = new Set<string>()
  for (const question of parsed.data) {
    if (
      ids.has(question.id) ||
      new Set(question.options.map((option) => option.id)).size !== question.options.length
    )
      throw new AppError('VALIDATION_ERROR', { message: '题目ID和同一题内的选项ID不可重复' })
    ids.add(question.id)
  }
  return parsed.data.map((question) => ({ ...question, allowFreeText: true }))
}

/** 全组校验成功后才交给状态机提交，禁止部分回答释放等待。 */
export function validateAgentInputAnswers(
  request: Parameters<typeof getAgentInputQuestions>[0],
  value: unknown,
): AgentInputAnswer[] {
  const parsed = answersSchema.safeParse(value)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', { message: '回答格式无效或内容过长' })
  const questions = getAgentInputQuestions(request)
  const answers = parsed.data
  if (
    answers.length !== questions.length ||
    new Set(answers.map((answer) => answer.questionId)).size !== answers.length
  )
    throw new AppError('VALIDATION_ERROR', { message: '请完成全部问题后统一提交' })
  return questions.map((question) => {
    const answer = answers.find((item) => item.questionId === question.id)
    if (!answer) throw new AppError('VALIDATION_ERROR', { message: '回答包含未知题目或遗漏题目' })
    const selected = [...new Set(answer.selectedOptionIds)]
    if (
      (!question.multiple && selected.length > 1) ||
      selected.some((id) => !question.options.some((option) => option.id === id))
    )
      throw new AppError('VALIDATION_ERROR', { message: '回答包含无效选项或超出单选限制' })
    const message = answer.message || undefined
    if (message && question.allowFreeText === false)
      throw new AppError('VALIDATION_ERROR', { message: '这个问题不接受自由回答' })
    if (!selected.length && !message)
      throw new AppError('VALIDATION_ERROR', { message: '请选择选项或填写回答' })
    return { questionId: question.id, selectedOptionIds: selected, message }
  })
}

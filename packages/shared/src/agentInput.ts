export interface AgentInputOption {
  id: string
  label: string
  description?: string
}

export interface AgentInputQuestion {
  id: string
  question: string
  context?: string
  options: AgentInputOption[]
  multiple: boolean
  allowFreeText?: boolean
}

export interface AgentInputAnswer {
  questionId: string
  selectedOptionIds: string[]
  message?: string
}

export interface AgentInputSubmission {
  answers?: AgentInputAnswer[]
  selectedOptionIds?: string[]
  message?: string
  skipped?: boolean
}

/** 旧单题按原有多选规则读取，新请求使用明确的题目列表。 */
export function getAgentInputQuestions(input: {
  questions?: AgentInputQuestion[]
  question: string
  options?: AgentInputOption[]
  allowFreeText?: boolean
}): AgentInputQuestion[] {
  return input.questions?.length
    ? input.questions
    : [
        {
          id: 'question',
          question: input.question,
          options: input.options ?? [],
          multiple: true,
          allowFreeText: input.allowFreeText !== false,
        },
      ]
}

/** 保留题目与选项名称，供迟到回答恢复原会话时使用。 */
export function formatAgentInputAnswers(input: {
  questions?: AgentInputQuestion[]
  question: string
  options: AgentInputOption[]
  allowFreeText?: boolean
  answers?: AgentInputAnswer[]
  selectedOptionIds: string[]
  responseMessage?: string
}): string {
  const questions = getAgentInputQuestions(input)
  const answers = input.answers?.length
    ? input.answers
    : [
        {
          questionId: questions[0]!.id,
          selectedOptionIds: input.selectedOptionIds,
          message: input.responseMessage,
        },
      ]
  return questions
    .map((question, index) => {
      const answer = answers.find((entry) => entry.questionId === question.id)
      const labels = question.options
        .filter((option) => answer?.selectedOptionIds.includes(option.id))
        .map((option) => option.label)
      return `${index + 1}. ${question.question}\n${[...labels, answer?.message].filter(Boolean).join('\n')}`
    })
    .join('\n\n')
}

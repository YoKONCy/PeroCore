<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed, nextTick, ref, watch } from 'vue'
import {
  getAgentInputQuestions,
  type AgentInputAnswer,
  type AgentInputSubmission,
  type InputSurfaceProps,
} from '@infos/shared'
import { PButton, PixelIcon } from '../pixel'
import AgentRequestIdentity from './AgentRequestIdentity.vue'
import { readAgentInputDraft, saveAgentInputDraft } from './agentInputDraft'

const props = defineProps<{ request: InputSurfaceProps; loading?: boolean; error?: string }>()
const emit = defineEmits<{ answer: [payload: AgentInputSubmission] }>()
const questions = computed(() => getAgentInputQuestions(props.request))
const signature = computed(() => JSON.stringify(questions.value))
const answers = ref<AgentInputAnswer[]>([])
const completed = ref<string[]>([])
const index = ref(0)
const review = ref(false)
const showText = ref(false)
const textarea = ref<HTMLTextAreaElement | null>(null)
const questionHeading = ref<HTMLElement | null>(null)
const current = computed(() => questions.value[index.value]!)
const currentAnswer = computed(() => answers.value[index.value]!)
const contextMessage = computed(() => {
  const message = props.request.context?.message
  return typeof message === 'string' ? message : ''
})
function valid(answer: AgentInputAnswer | undefined): boolean {
  return !!answer && (!!answer.selectedOptionIds.length || !!answer.message?.trim())
}
const allDone = computed(() =>
  questions.value.every(
    (question, i) => completed.value.includes(question.id) && valid(answers.value[i]),
  ),
)

watch(
  () => [props.request.inputId, signature.value],
  () => {
    const draft = readAgentInputDraft(props.request.inputId, signature.value)
    answers.value = questions.value.map((question) => {
      const saved = draft?.answers.find((answer) => answer?.questionId === question.id)
      const selected = Array.isArray(saved?.selectedOptionIds)
        ? saved.selectedOptionIds.filter((id) =>
            question.options.some((option) => option.id === id),
          )
        : []
      return {
        questionId: question.id,
        selectedOptionIds: question.multiple ? [...new Set(selected)] : selected.slice(0, 1),
        message:
          question.allowFreeText !== false && typeof saved?.message === 'string'
            ? saved.message.slice(0, 4000)
            : '',
      }
    })
    completed.value = questions.value
      .filter((question, i) => draft?.completed.includes(question.id) && valid(answers.value[i]))
      .map((question) => question.id)
    index.value = Number.isInteger(draft?.index)
      ? Math.max(0, Math.min(questions.value.length - 1, draft!.index))
      : 0
    review.value = !!draft?.review && allDone.value
    showText.value = !!currentAnswer.value?.message || !current.value.options.length
  },
  { immediate: true },
)
watch(
  [answers, completed, index, review],
  () => {
    saveAgentInputDraft(props.request.inputId, {
      signature: signature.value,
      answers: answers.value,
      completed: completed.value,
      index: index.value,
      review: review.value,
    })
  },
  { deep: true, flush: 'sync' },
)

function visit(i: number): void {
  if (props.loading) return
  index.value = i
  review.value = false
  showText.value = !!currentAnswer.value.message || !current.value.options.length
  void nextTick(() => questionHeading.value?.focus({ preventScroll: true }))
}
function edit(): void {
  completed.value = completed.value.filter((id) => id !== current.value.id)
}
function complete(): void {
  if (props.loading || !valid(currentAnswer.value)) return
  completed.value = [...new Set([...completed.value, current.value.id])]
  const next = questions.value.findIndex(
    (question, i) => i > index.value && !completed.value.includes(question.id),
  )
  const missing = questions.value.findIndex((question) => !completed.value.includes(question.id))
  if (next >= 0 || missing >= 0) visit(next >= 0 ? next : missing)
  else {
    review.value = true
    void nextTick(() => questionHeading.value?.focus({ preventScroll: true }))
  }
}
function select(id: string, supplement = false): void {
  if (props.loading) return
  edit()
  const selected = currentAnswer.value.selectedOptionIds
  currentAnswer.value.selectedOptionIds = current.value.multiple
    ? supplement
      ? [...new Set([...selected, id])]
      : selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id]
    : [id]
  if (supplement) {
    showText.value = true
    void nextTick(() => textarea.value?.focus())
  } else if (!current.value.multiple && !showText.value) complete()
}
function customize(): void {
  if (props.loading) return
  edit()
  currentAnswer.value.selectedOptionIds = []
  showText.value = true
  void nextTick(() => textarea.value?.focus())
}
function answerLabel(answer: AgentInputAnswer, i: number): string {
  return [
    ...questions.value[i]!.options.filter((option) =>
      answer.selectedOptionIds.includes(option.id),
    ).map((option) => option.label),
    answer.message?.trim(),
  ]
    .filter(Boolean)
    .join('；')
}
function submit(): void {
  if (!allDone.value || props.loading) return
  emit('answer', {
    answers: answers.value.map((answer) => ({
      ...answer,
      selectedOptionIds: [...answer.selectedOptionIds],
      message: answer.message?.trim() || undefined,
    })),
  })
}
</script>

<template>
  <article class="agent-input-card" :aria-busy="loading">
    <header class="agent-input-card__header">
      <AgentRequestIdentity
        :agent-id="request.principalId || 'pero'"
        :subtitle="__t('ui.agent', '回答后会继续刚才的工作')"
      >
        <template #title>{{ __t('ui.agent', '想问问你') }}</template>
      </AgentRequestIdentity>
      <span class="agent-input-card__waiting">
        <i />
        {{ __t('ui.agent', '等待回答') }}
      </span>
    </header>
    <nav
      v-if="questions.length > 1"
      class="question-steps"
      :aria-label="__t('ui.agent', '题目导航')"
    >
      <button
        v-for="(question, i) in questions"
        :key="question.id"
        type="button"
        :class="{ active: !review && index === i, done: completed.includes(question.id) }"
        :aria-current="!review && index === i ? 'step' : undefined"
        :aria-label="
          __t('ui.agent', '第{0}题{1}', [i + 1, completed.includes(question.id) ? '，已填写' : ''])
        "
        :disabled="loading"
        @click="visit(i)"
      >
        <span>{{ i + 1 }}</span>
        <PixelIcon v-if="completed.includes(question.id)" name="check" size="xs" />
      </button>
      <span>{{ completed.length }} / {{ questions.length }}</span>
    </nav>
    <p v-if="contextMessage" class="question-context question-context--group">
      {{ contextMessage }}
    </p>
    <fieldset :disabled="loading" class="question-body">
      <template v-if="!review">
        <div class="question-caption">
          <span>{{ __t('ui.agent', '第') }} {{ index + 1 }} {{ __t('ui.agent', '题') }}</span>
          <span>
            {{
              current.multiple && current.options.length
                ? __t('ui.agent', '可多选')
                : current.options.length
                  ? __t('ui.agent', '选一项，或自己回答')
                  : __t('ui.agent', '写下你的回答')
            }}
          </span>
        </div>
        <h3 ref="questionHeading" tabindex="-1">{{ current.question }}</h3>
        <p v-if="current.context" class="question-context">{{ current.context }}</p>
        <div v-if="current.options.length" class="question-options">
          <div
            v-for="(option, optionIndex) in current.options"
            :key="option.id"
            class="question-option"
            :class="{ selected: currentAnswer.selectedOptionIds.includes(option.id) }"
          >
            <button
              type="button"
              :aria-pressed="currentAnswer.selectedOptionIds.includes(option.id)"
              @click="select(option.id)"
            >
              <span class="question-option__key">{{ String.fromCharCode(65 + optionIndex) }}</span>
              <span class="question-option__label">
                <strong>{{ option.label }}</strong>
                <small v-if="option.description">{{ option.description }}</small>
              </span>
              <PixelIcon
                v-if="currentAnswer.selectedOptionIds.includes(option.id)"
                name="check"
                size="xs"
              />
            </button>
            <button
              v-if="current.allowFreeText !== false"
              class="question-option__supplement"
              type="button"
              :aria-label="__t('ui.agent', '选择{0}并补充', [option.label])"
              @click="select(option.id, true)"
            >
              {{ __t('ui.agent', '补充') }}
            </button>
          </div>
        </div>
        <button
          v-if="current.options.length && current.allowFreeText !== false"
          type="button"
          class="question-custom"
          @click="customize"
        >
          <PixelIcon name="edit" size="xs" />
          {{ __t('ui.agent', '自定义回答') }}
        </button>
        <label v-if="showText && current.allowFreeText !== false" class="question-text">
          <span>
            {{
              currentAnswer.selectedOptionIds.length
                ? __t('ui.agent', '补充说明')
                : __t('ui.agent', '你的回答')
            }}
          </span>
          <textarea
            ref="textarea"
            v-model="currentAnswer.message"
            rows="3"
            maxlength="4000"
            :placeholder="__t('ui.agent', '写下你的想法…')"
            @input="edit"
          />
        </label>
        <div class="question-controls">
          <button v-if="index > 0" type="button" class="question-back" @click="visit(index - 1)">
            {{ __t('ui.agent', '上一题') }}
          </button>
          <PButton size="sm" :disabled="loading || !valid(currentAnswer)" @click="complete">
            {{ questions.length === 1 ? __t('ui.agent', '确认回答') : __t('ui.agent', '完成本题') }}
          </PButton>
        </div>
      </template>
      <template v-else>
        <h3 ref="questionHeading" tabindex="-1">{{ __t('ui.agent', '回答都在这里了') }}</h3>
        <ol class="question-review">
          <li v-for="(question, i) in questions" :key="question.id">
            <div>
              <strong>{{ question.question }}</strong>
              <p>{{ answerLabel(answers[i]!, i) }}</p>
            </div>
            <button
              type="button"
              class="question-back"
              :aria-label="__t('ui.agent', '修改第{0}题', [i + 1])"
              @click="visit(i)"
            >
              {{ __t('ui.agent', '修改') }}
            </button>
          </li>
        </ol>
      </template>
    </fieldset>
    <p v-if="error" class="question-error" role="alert">{{ error }}</p>
    <footer class="agent-input-card__actions">
      <button
        v-if="!request.required"
        type="button"
        class="question-back"
        :disabled="loading"
        @click="emit('answer', { skipped: true })"
      >
        {{ __t('ui.agent', '暂时跳过') }}
      </button>
      <span v-if="!review" class="question-footnote">{{ __t('ui.agent', '填好后统一提交') }}</span>
      <PButton v-else size="sm" :disabled="loading || !allDone" @click="submit">
        {{ loading ? __t('ui.agent', '正在提交…') : __t('ui.agent', '提交回答') }}
      </PButton>
    </footer>
  </article>
</template>

<style scoped src="./agent-input-card.css" />

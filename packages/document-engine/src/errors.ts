import type { KernelError } from '@infos/shared'

export class DocumentEngineError extends Error {
  readonly kernelError: KernelError

  constructor(
    code: string,
    message: string,
    retryable = false,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'DocumentEngineError'
    this.kernelError = { code, message, retryable, ...(details ? { details } : {}) }
  }
}

export function failDocument(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  retryable = false,
): never {
  throw new DocumentEngineError(code, message, retryable, details)
}

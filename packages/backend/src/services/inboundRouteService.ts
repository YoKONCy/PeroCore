import { AppError } from '../lib/appError'
import type {
  CreateInboundRouteInput,
  InboundRouteRepository,
  UpdateInboundRouteInput,
} from '../repositories/inboundRoute.repo'

/** 入站路由用例层；封装存在性、冲突和CRUD业务语义。 */
export class InboundRouteService {
  constructor(private readonly repository: InboundRouteRepository) {}

  list() {
    return this.repository.list()
  }

  async resolve(source: string, identifier: string) {
    const route = await this.repository.resolve(source, identifier)
    if (!route) throw new AppError('NOT_FOUND', { message: '未匹配到路由' })
    return route
  }

  async create(input: CreateInboundRouteInput) {
    const existing = await this.repository.findBySourceAndIdentifier(input.source, input.identifier)
    if (existing) {
      throw new AppError('ALREADY_EXISTS', {
        message: `路由已存在: ${input.source}/${input.identifier}`,
        data: { source: input.source, identifier: input.identifier },
      })
    }
    return this.repository.create(input)
  }

  async update(id: string, input: UpdateInboundRouteInput) {
    const route = await this.repository.update(id, input)
    if (!route) throw new AppError('NOT_FOUND', { message: `路由 "${id}" 不存在` })
    return route
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repository.findById(id))) {
      throw new AppError('NOT_FOUND', { message: `路由 "${id}" 不存在` })
    }
    await this.repository.delete(id)
  }
}

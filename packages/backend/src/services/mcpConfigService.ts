import { AppError } from '../lib/appError'
import type {
  CreateMcpConfigInput,
  McpConfigRepository,
  UpdateMcpConfigInput,
} from '../repositories/mcp.repo'
import type { McpClientManager } from './mcp/mcpClientManager'

/** MCP配置与连接生命周期用例层。 */
export class McpConfigService {
  constructor(
    private readonly repository: McpConfigRepository,
    private readonly manager: McpClientManager,
  ) {}

  async list() {
    return (await this.repository.findAll()).map(parseConfig)
  }

  async create(input: CreateMcpConfigInput) {
    if (await this.repository.findByName(input.name)) {
      throw new AppError('DUPLICATE_NAME', { message: `MCP 配置 "${input.name}" 已存在` })
    }
    return parseConfig(await this.repository.create(input))
  }

  async update(id: number, input: UpdateMcpConfigInput) {
    const config = await this.repository.update(id, input)
    if (!config) throw new AppError('NOT_FOUND', { message: `MCP 配置 #${id} 不存在` })
    return parseConfig(config)
  }

  async delete(id: number): Promise<void> {
    const config = await this.repository.findById(id)
    if (!config) throw new AppError('NOT_FOUND', { message: `MCP 配置 #${id} 不存在` })
    await this.manager.disconnectOne(config.name)
    await this.repository.delete(id)
  }

  async toggle(id: number) {
    const config = await this.repository.toggleEnabled(id)
    if (!config) throw new AppError('NOT_FOUND', { message: `MCP 配置 #${id} 不存在` })
    return parseConfig(config)
  }
}

function parseConfig<T extends { args: string | null; env: string | null }>(config: T) {
  return {
    ...config,
    args: config.args ? JSON.parse(config.args) : [],
    env: config.env ? JSON.parse(config.env) : {},
  }
}

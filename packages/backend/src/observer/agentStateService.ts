import type { AgentStateRepository } from './agentStateRepository'
import { projectAgentStateSurface } from './agentStateSurfaceProjection'

/** Observer管理用例层；Router不得直接依赖Repository。 */
export class AgentStateService {
  constructor(private readonly repository: AgentStateRepository) {}

  exportAgent(agentId: string) {
    return this.repository.exportAgent(agentId)
  }

  project(agentId: string) {
    return projectAgentStateSurface(this.repository, agentId)
  }

  async updatePolicy(agentId: string, input: { enabled: boolean; injectContext: boolean }) {
    await this.repository.setPolicy(agentId, input)
    return this.repository.getPolicy(agentId)
  }

  async deleteAgent(agentId: string) {
    return { deleted: await this.repository.deleteAgent(agentId) }
  }
}

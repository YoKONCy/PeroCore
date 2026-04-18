/**
 * types.ts
 * Dashboard 共享类型定义
 */

// ─── API 数据模型 ──────────────────────────────────────────────────────────────

export interface Agent {
  id: string
  name: string
  avatar: string | null
  avatarUrl: string | null
  is_active: boolean
  is_enabled: boolean
}

export interface PetState {
  mood?: 'happy' | 'sad' | 'angry' | 'surprised' | 'neutral'
  energy?: number
  hunger?: number
  affection?: number
  [key: string]: unknown
}

export interface Stats {
  total_memories: number
  total_logs: number
  total_tasks: number
}

export interface NitStatus {
  enabled?: boolean
  [key: string]: unknown
}

export interface NapCatBotInfo {
  nickname?: string
  user_id?: string
  [key: string]: unknown
}

export interface NapCatStatus {
  ws_connected: boolean
  api_responsive: boolean
  latency_ms: number
  disabled: boolean
  bot_info: NapCatBotInfo | null
  bot_infos: NapCatBotInfo[]
  connection_count: number
  connected_ids: string[]
  last_connected_at: string | null
  last_event_at: string | null
  last_error: string | null
  ws_auth_required: boolean
  ws_auth_header: string
  ws_auth_query: string
}

export interface MemoryConfig {
  modes: {
    desktop: { context_limit: number; rag_limit: number }
    work: { context_limit: number; rag_limit: number }
    social: {
      context_limit: number
      rag_limit: number
      advanced: {
        image_limit: number
        cross_context_users: number
        cross_context_history: number
      }
    }
  }
}

export interface GlobalConfig {
  global_llm_api_key: string
  global_llm_api_base: string
  provider: string
}

export interface Model {
  id?: number
  name: string
  model_id: string
  provider_type: 'global' | 'custom'
  provider: string
  api_key?: string
  api_base?: string
  temperature: number
  stream: boolean
  enable_vision: boolean
  enable_voice: boolean
  enable_video: boolean
  max_tokens?: number
  [key: string]: unknown
}

export interface Mcp {
  id?: number
  name: string
  type: 'stdio' | 'sse'
  command?: string
  args?: string
  env?: string
  url?: string
  enabled: boolean
}

export interface UserSettings {
  owner_name: string
  user_persona: string
  owner_qq: string
}

export interface LogEntry {
  id: string | number
  role: string
  content: string
  raw_content?: string
  timestamp: string
  session_id?: string
  source?: string
  sentiment?: string | null
  importance?: number | null
  analysis_status?: 'pending' | 'processing' | 'success' | 'failed'
  metadata?: Record<string, unknown>
  metadata_json?: string
  displayTime: string
  images: string[]
}

export interface Memory {
  id: string | number
  content: string
  type?: string
  tags?: string[]
  timestamp: string
  sentiment?: string
  importance?: number
  realTime: string
  [key: string]: unknown
}

export interface Task {
  id: string | number
  title: string
  description?: string
  status?: string
  due_date?: string
  [key: string]: unknown
}

export interface MemoryGraphData {
  nodes: Array<{
    id: string | number
    value: number
    category?: string
    sentiment?: string
    full_content?: string
    [key: string]: unknown
  }>
  edges: Array<{
    source: string | number
    target: string | number
    value: number
    relation_type?: string
    [key: string]: unknown
  }>
}

export interface ConnectionInfo {
  ip: string
  port: number
  token: string
}

export interface ConfirmOptions {
  type?: 'warning' | 'info' | 'error' | 'success'
  isPrompt?: boolean
  inputValue?: string
  inputPlaceholder?: string
}

export interface ConfirmResult {
  action: 'confirm' | 'cancel'
  value?: string
}

export interface PromptMessage {
  role: string
  content: string
}

export interface DebugSegment {
  type: 'thinking' | 'monologue' | 'nit' | 'text'
  content: string
}

export interface ProviderOption {
  label: string
  value: string
}

export interface McpTypeOption {
  label: string
  value: 'stdio' | 'sse'
}

export interface TagCloudItem {
  tag: string
  count: number
}

export interface ParticleItem {
  id: number
  style: Record<string, string>
  icon: string
  size: string
}

export interface UpdateStatus {
  type: 'idle' | 'checking' | 'available' | 'not-available' | 'downloaded' | 'error'
  info?: { version: string }
  error?: string
}

export interface MenuItem {
  id: string
  label: string
  icon: string
  variant?: string
}

export interface MenuGroup {
  title: string | null
  items: MenuItem[]
}

export interface AppConfig {
  onboarding_completed?: boolean | 'launcher_done'
  [key: string]: unknown
}

// ─── Composable 返回类型（辅助） ──────────────────────────────────────────────

export type OpenConfirmFn = (
  title: string,
  content: string,
  options?: ConfirmOptions
) => Promise<ConfirmResult>

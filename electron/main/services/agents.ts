import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'

const isDev = !app.isPackaged

function getRootPath() {
    if (isDev) {
        // Dev: dist-electron/main/services -> PeroCore-Electron
        // 开发环境: dist-electron/main/services -> PeroCore-Electron
        return path.resolve(__dirname, '../../..')
    } else {
        return process.resourcesPath
    }
}

export async function scanLocalAgents() {
    const root = getRootPath()
    // Backend structure: backend/services/mdp/agents
    // In prod, backend is likely in resources/backend
    // 后端结构: backend/services/mdp/agents
    // 生产环境中，后端可能位于 resources/backend
    const backendAgentsDir = path.join(root, 'backend/services/mdp/agents')
    const globalConfigPath = path.join(root, 'backend/data/agent_launch_config.json')
    
    console.log(`[Agents] 正在扫描 Agents，路径: ${backendAgentsDir}`)
    console.log(`[Agents] 全局配置路径: ${globalConfigPath}`)

    if (!await fs.pathExists(backendAgentsDir)) {
        console.warn(`[Agents] 未找到 Agents 目录: ${backendAgentsDir}`)
        return []
    }
    
    // Load global config
    // 加载全局配置
    let globalConfig = { enabled_agents: [] as string[], active_agent: '' }
    try {
        if (await fs.pathExists(globalConfigPath)) {
            const loadedConfig = await fs.readJson(globalConfigPath)
            globalConfig = { ...globalConfig, ...loadedConfig }
            console.log('[Agents] 已加载全局配置:', globalConfig)
        } else {
            console.log('[Agents] 全局配置未找到，使用默认值')
        }
    } catch (e) {
        console.warn('[Agents] 加载全局 Agent 配置失败', e)
    }
    
    const agents = []
    const files = await fs.readdir(backendAgentsDir)
    for (const file of files) {
        const agentDir = path.join(backendAgentsDir, file)
        try {
            const stat = await fs.stat(agentDir)
            if (stat.isDirectory()) {
                // Check for config.json
                // 检查 config.json
                const configPath = path.join(agentDir, 'config.json')
                if (await fs.pathExists(configPath)) {
                    try {
                        const config = await fs.readJson(configPath)
                        const id = file
                        
                        // Merge with global status
                        // 合并全局状态
                        const isEnabled = globalConfig.enabled_agents.includes(id)
                        const isActive = globalConfig.active_agent === id
                        
                        agents.push({
                            id: id,
                            name: config.name || id,
                            description: config.description || '',
                            avatar: config.avatar || '',
                            path: agentDir,
                            is_enabled: isEnabled,
                            is_active: isActive,
                            ...config
                        })
                    } catch (e) {
                        console.error(`无法读取 ${file} 的配置`, e)
                        agents.push({ id: file, name: file, description: '配置错误' })
                    }
                }
            }
        } catch (e) {
            // Ignore access errors
            // 忽略访问错误
        }
    }
    return agents
}

export async function getPlugins() {
    const root = getRootPath()
    // Backend structure: backend/nit_core/plugins
    // 后端结构: backend/nit_core/plugins
    const pluginsDir = path.join(root, 'backend/nit_core/plugins')
    
    console.log(`[插件] 正在扫描插件，路径: ${pluginsDir}`)

    if (!await fs.pathExists(pluginsDir)) {
        console.warn(`[Plugins] Directory not found: ${pluginsDir}`)
        return []
    }
    
    const plugins = []
    try {
        const files = await fs.readdir(pluginsDir)
        console.log(`[Plugins] Files found: ${files.join(', ')}`)
        
        for (const file of files) {
            // Skip hidden/cache files
            // 跳过隐藏/缓存文件
            if (file.startsWith('__') || file.startsWith('.')) {
                continue
            }
            
            const pluginDir = path.join(pluginsDir, file)
            try {
                const stat = await fs.stat(pluginDir)
                if (stat.isDirectory()) {
                     // Check description.json
                     // 检查 description.json
                    const descPath = path.join(pluginDir, 'description.json')
                    if (await fs.pathExists(descPath)) {
                        try {
                            const desc = await fs.readJson(descPath)
                            plugins.push({
                                name: file,
                                valid: true,
                                ...desc
                            })
                            console.log(`[Plugins] Loaded ${file}`)
                        } catch (e) {
                            console.error(`[Plugins] Failed to parse description.json for ${file}`, e)
                            plugins.push({ name: file, valid: false, description: "Invalid config" })
                        }
                    } else {
                        // Guess or list
                        // 猜测或列出
                        console.log(`[Plugins] ${file} missing description.json`)
                        plugins.push({ name: file, valid: true, description: "Custom Plugin" })
                    }
                }
            } catch (e) {
                console.error(`[Plugins] Error processing ${file}`, e)
            }
        }
    } catch (e) {
        console.error(`[Plugins] Failed to read plugins dir`, e)
    }
    
    console.log(`[Plugins] Returned ${plugins.length} plugins`)
    return plugins
}

export async function saveGlobalLaunchConfig(enabledAgents: string[], activeAgent: string) {
    const root = getRootPath()
    const dataDir = path.join(root, 'backend/data')
    const configPath = path.join(dataDir, 'agent_launch_config.json')

    console.log(`[Config] 正在保存全局配置到 ${configPath}`)
    console.log(`[Config] 数据:`, { enabledAgents, activeAgent })

    try {
        await fs.ensureDir(dataDir)
        
        const config = {
            enabled_agents: enabledAgents,
            active_agent: activeAgent
        }
        
        await fs.writeJson(configPath, config, { spaces: 4 })
        console.log(`[Config] 保存成功`)
        return config
    } catch (e) {
        console.error(`[Config] 保存全局配置失败`, e)
        throw e
    }
}

export async function saveAgentLaunchConfig(agentId: string, config: any) {
    const root = getRootPath()
    const backendAgentsDir = path.join(root, 'backend/services/mdp/agents')
    const agentDir = path.join(backendAgentsDir, agentId)
    const configPath = path.join(agentDir, 'config.json')

    if (!await fs.pathExists(configPath)) {
        throw new Error(`Agent config not found: ${configPath}`)
    }

    // Merge existing with new
    // 合并现有配置和新配置
    const current = await fs.readJson(configPath)
    const newConfig = { ...current, ...config }
    await fs.writeJson(configPath, newConfig, { spaces: 4 })
    return newConfig
}

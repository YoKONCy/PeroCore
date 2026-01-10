<template>
  <div class="dashboard-wrapper">
    <!-- 动态背景 -->
    <div class="background-blobs">
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
      <div class="blob blob-3"></div>
    </div>

    <el-container class="main-layout">
      <!-- 侧边导航栏 -->
      <el-aside width="260px" class="glass-sidebar">
        <div class="brand-area">
          <div class="logo-box">
            <span class="logo-emoji">🎀</span>
          </div>
          <div class="brand-text">
            <h1>PeroCore</h1>
            <span class="version-tag">v1.0.0</span>
          </div>
        </div>
        
        <el-menu
          :default-active="currentTab"
          class="sidebar-menu"
          @select="handleTabSelect"
          text-color="#5a5e66"
          active-text-color="#ff88aa"
        >
          <el-menu-item index="overview">
            <el-icon><IconMenu /></el-icon>
            <span>总览 (Overview)</span>
          </el-menu-item>
          <el-menu-item index="logs">
            <el-icon><ChatLineRound /></el-icon>
            <span>对话日志 (Logs)</span>
          </el-menu-item>
          <el-menu-item index="memories">
            <el-icon><Cpu /></el-icon>
            <span>核心记忆 (Memories)</span>
          </el-menu-item>
          <el-menu-item index="tasks">
            <el-icon><Bell /></el-icon>
            <span>待办任务 (Tasks)</span>
          </el-menu-item>
          <el-menu-item index="model_config">
            <el-icon><SetUp /></el-icon>
            <span>模型配置 (Models)</span>
          </el-menu-item>
          <el-menu-item index="voice_config">
            <el-icon><Microphone /></el-icon>
            <span>语音功能 (Voice)</span>
          </el-menu-item>
          <el-menu-item index="mcp_config">
            <el-icon><Connection /></el-icon>
            <span>MCP 配置 (Connect)</span>
          </el-menu-item>
          <el-menu-item index="user_settings">
            <el-icon><User /></el-icon>
            <span>用户设定 (User)</span>
          </el-menu-item>
          <el-menu-item index="system_reset" style="color: #f56c6c;">
            <el-icon><Warning /></el-icon>
            <span>危险区域 (Danger)</span>
          </el-menu-item>
        </el-menu>

        <div class="sidebar-footer">
          <el-button 
            class="quit-button" 
            type="danger" 
            plain 
            @click="handleQuitApp"
          >
            <el-icon><SwitchButton /></el-icon>
            <span>退出系统 (Quit)</span>
          </el-button>
          
          <div class="status-indicator" :class="{ online: isBackendOnline }">
            <span class="dot"></span>
            {{ isBackendOnline ? 'System Online' : 'System Offline' }}
          </div>
        </div>
      </el-aside>

      <el-container>
        <!-- 顶部栏 -->
        <el-header class="glass-header">
          <div class="header-left">
            <h2 class="page-title">{{ currentTabName }}</h2>
            <el-tag v-if="isSaving" type="warning" effect="dark" round size="small">
              <el-icon class="is-loading"><Refresh /></el-icon> 保存中...
            </el-tag>
          </div>
          <div class="header-right">
             <el-button circle :icon="Refresh" @click="fetchAllData" :loading="isGlobalRefreshing" title="刷新所有数据"></el-button>
          </div>
        </el-header>

        <!-- 主内容区 -->
        <el-main class="content-area">
          <div class="view-container-wrapper" style="height: 100%;">
              <!-- 1. 仪表盘概览 -->
                <div v-show="currentTab === 'overview'" key="overview" class="view-container">
              <!-- Live Monitor Entry Button -->
              <el-row :gutter="20" style="margin-bottom: 20px;">
                <el-col :span="24">
                   <el-alert
                    title="思维监控室 (Thinking Monitor)"
                    type="info"
                    description="实时查看 Pero 的思考过程、错误修正与自我反思。"
                    show-icon
                    :closable="false"
                  >
                    <template #default>
                       <div style="margin-top: 10px;">
                         <el-button type="primary" size="small" @click="openLiveMonitor">进入监控室</el-button>
                       </div>
                    </template>
                  </el-alert>
                </el-col>
              </el-row>

              <el-row :gutter="20">
                <el-col :span="8">
                  <el-card shadow="hover" class="stat-card pink-gradient">
                    <div class="stat-content">
                      <div class="stat-icon">🧠</div>
                      <div class="stat-info">
                        <h3>核心记忆</h3>
                        <div class="number">{{ memories.length }}</div>
                      </div>
                    </div>
                  </el-card>
                </el-col>
                <el-col :span="8">
                  <el-card shadow="hover" class="stat-card blue-gradient">
                    <div class="stat-content">
                      <div class="stat-icon">💬</div>
                      <div class="stat-info">
                        <h3>近期对话</h3>
                        <div class="number">{{ logs.length }}</div>
                      </div>
                    </div>
                  </el-card>
                </el-col>
                <el-col :span="8">
                  <el-card shadow="hover" class="stat-card purple-gradient">
                    <div class="stat-content">
                      <div class="stat-icon">⚡</div>
                      <div class="stat-info">
                        <h3>待办任务</h3>
                        <div class="number">{{ tasks.length }}</div>
                      </div>
                    </div>
                  </el-card>
                </el-col>
              </el-row>

              <el-row :gutter="20" style="margin-top: 20px;">
                <el-col :span="24">
                  <el-card shadow="never" class="glass-card">
                    <template #header>
                      <div class="card-header">
                        <span>当前状态 (PetState)</span>
                      </div>
                    </template>
                    <el-row :gutter="20">
                      <el-col :span="8">
                        <div class="state-box">
                          <span class="label">Mood (心情)</span>
                          <span class="value">{{ petState.mood || 'Unknown' }}</span>
                          <el-progress :percentage="80" :show-text="false" color="#ff88aa" />
                        </div>
                      </el-col>
                      <el-col :span="8">
                        <div class="state-box">
                          <span class="label">Vibe (氛围)</span>
                          <span class="value">{{ petState.vibe || 'Unknown' }}</span>
                          <el-progress :percentage="60" :show-text="false" color="#a0c4ff" />
                        </div>
                      </el-col>
                      <el-col :span="8">
                        <div class="state-box">
                          <span class="label">Mind (想法)</span>
                          <span class="value">{{ petState.mind || 'Unknown' }}</span>
                          <el-progress :percentage="90" :show-text="false" color="#a8e6cf" />
                        </div>
                      </el-col>
                    </el-row>
                  </el-card>
                </el-col>
              </el-row>

              <!-- System Monitor Card -->
              <el-row :gutter="20" style="margin-top: 20px;" v-if="systemStatus && systemStatus.cpu">
                <el-col :span="24">
                  <el-card shadow="hover" class="glass-card" :body-style="{ padding: '15px 20px' }">
                    <template #header>
                      <div class="card-header">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <el-icon><Monitor /></el-icon>
                            <span>系统性能 (System Monitor)</span>
                        </div>
                        <el-tag size="small" effect="plain" type="info">Real-time</el-tag>
                      </div>
                    </template>
                    <el-row :gutter="40" justify="space-around" align="middle">
                      <!-- CPU -->
                      <el-col :span="8" class="monitor-col">
                        <div class="monitor-item">
                          <el-progress type="dashboard" :percentage="systemStatus.cpu.percent" :color="cpuColor" :width="120" :stroke-width="10">
                            <template #default="{ percentage }">
                              <span class="percentage-value">{{ percentage }}%</span>
                              <span class="percentage-label">CPU</span>
                            </template>
                          </el-progress>
                          <div class="monitor-detail">
                             <span>{{ systemStatus.cpu.count }} Cores</span>
                          </div>
                        </div>
                      </el-col>
                      <!-- Memory -->
                      <el-col :span="8" class="monitor-col">
                         <div class="monitor-item">
                          <el-progress type="dashboard" :percentage="systemStatus.memory.percent" :color="memColor" :width="120" :stroke-width="10">
                            <template #default="{ percentage }">
                              <span class="percentage-value">{{ percentage }}%</span>
                              <span class="percentage-label">RAM</span>
                            </template>
                          </el-progress>
                          <div class="monitor-detail">
                             <span>{{ formatBytes(systemStatus.memory.used) }} / {{ formatBytes(systemStatus.memory.total) }}</span>
                          </div>
                        </div>
                      </el-col>
                      <!-- Disk -->
                      <el-col :span="8" class="monitor-col">
                         <div class="monitor-item">
                          <el-progress type="dashboard" :percentage="systemStatus.disk.percent" :color="diskColor" :width="120" :stroke-width="10">
                            <template #default="{ percentage }">
                              <span class="percentage-value">{{ percentage }}%</span>
                              <span class="percentage-label">Disk</span>
                            </template>
                          </el-progress>
                          <div class="monitor-detail">
                             <span>{{ formatBytes(systemStatus.disk.used) }} / {{ formatBytes(systemStatus.disk.total) }}</span>
                          </div>
                        </div>
                      </el-col>
                    </el-row>
                  </el-card>
                </el-col>
              </el-row>

              <!-- NIT Status Card -->
              <el-row :gutter="20" style="margin-top: 20px;" v-if="nitStatus">
                <el-col :span="24">
                   <el-card shadow="hover" class="glass-card" :body-style="{ padding: '15px 20px' }">
                      <div class="nit-status-box">
                         <div class="nit-header">
                            <div class="nit-title">
                               <el-icon><Connection /></el-icon>
                               <span>NIT Protocol Status</span>
                               <el-tag size="small" effect="dark" type="success">Active</el-tag>
                            </div>
                            <div class="nit-metrics">
                               <span class="metric">
                                  <strong>{{ nitStatus.plugins_count }}</strong> Plugins Loaded
                               </span>
                               <el-divider direction="vertical" />
                               <span class="metric">
                                  <strong>{{ nitStatus.active_mcp_count }}</strong> MCP Servers Connected
                               </span>
                            </div>
                         </div>
                         <div class="nit-plugins-list" v-if="nitStatus.plugins && nitStatus.plugins.length">
                            <el-tag 
                               v-for="p in nitStatus.plugins.slice(0, 8)" 
                               :key="p.name" 
                               size="small" 
                               type="info" 
                               effect="plain"
                               class="mini-plugin-tag"
                            >
                               {{ p.name }}
                            </el-tag>
                            <span v-if="nitStatus.plugins.length > 8" class="more-tag">...and {{ nitStatus.plugins.length - 8 }} more</span>
                         </div>
                      </div>
                   </el-card>
                </el-col>
              </el-row>

              <!-- 轻量聊天模式卡片 -->
              <el-row :gutter="20" style="margin-top: 20px;">
                <el-col :span="24">
                  <el-card shadow="hover" class="glass-card" :body-style="{ padding: '15px 20px' }">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="font-size: 24px;">🍃</div>
                        <div>
                           <div style="font-weight: bold; font-size: 16px;">轻量聊天模式 (Lightweight Mode)</div>
                           <div style="font-size: 13px; color: #666; margin-top: 4px;">开启后，将禁用大部分高级工具以节省资源。仅保留视觉感知、记忆管理和基础管理功能。</div>
                        </div>
                      </div>
                      <el-switch 
                        v-model="isLightweightEnabled" 
                        active-text="ON" 
                        inactive-text="OFF"
                        @change="toggleLightweight"
                        :loading="isTogglingLightweight"
                      />
                    </div>
                  </el-card>
                </el-col>
              </el-row>

              <!-- 主动视觉感应卡片 -->
              <el-row :gutter="20" style="margin-top: 20px;">
                <el-col :span="24">
                  <el-card shadow="hover" class="glass-card" :body-style="{ padding: '15px 20px' }">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="font-size: 24px;">🔮</div>
                        <div>
                           <div style="font-weight: bold; font-size: 16px;">主动视觉感应 (AuraVision)</div>
                           <div style="font-size: 13px; color: #666; margin-top: 4px;">开启后，Pero 将通过摄像头主动感知你的存在并触发互动。采用隐私保护设计，仅提取特征。</div>
                        </div>
                      </div>
                      <el-switch 
                        v-model="isAuraVisionEnabled" 
                        active-text="ON" 
                        inactive-text="OFF"
                        @change="toggleAuraVision"
                        :loading="isTogglingAuraVision"
                      />
                    </div>
                  </el-card>
                </el-col>
              </el-row>

              <!-- 陪伴模式卡片 -->
              <el-row :gutter="20" style="margin-top: 20px;">
                <el-col :span="24">
                  <el-card shadow="hover" class="glass-card" :class="{ 'disabled-card': !isLightweightEnabled }" :body-style="{ padding: '15px 20px' }">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="font-size: 24px;">👀</div>
                        <div>
                           <div style="font-weight: bold; font-size: 16px;">智能陪伴模式 (Companion Mode)</div>
                           <div style="font-size: 13px; color: #666; margin-top: 4px;">
                             Pero 将自动观察你的屏幕动态并进行互动。
                             <span v-if="!isLightweightEnabled" style="color: #f56c6c; margin-left: 8px;">(需要先开启“轻量模式”)</span>
                           </div>
                        </div>
                      </div>
                      <el-tooltip
                        :content="!isLightweightEnabled ? '请先开启轻量模式' : (isCompanionEnabled ? '关闭陪伴' : '开启陪伴')"
                        placement="top"
                      >
                        <el-switch 
                          v-model="isCompanionEnabled" 
                          active-text="ON" 
                          inactive-text="OFF"
                          :disabled="!isLightweightEnabled"
                          @change="toggleCompanion"
                          :loading="isTogglingCompanion"
                        />
                      </el-tooltip>
                    </div>
                  </el-card>
                </el-col>
              </el-row>
            </div>

            <!-- 1.5 思维监控室 -->
            <div v-show="currentTab === 'task_monitor'" key="task_monitor" class="view-container" style="height: 100%; display: flex; flex-direction: column;">
               <div class="toolbar" style="padding: 10px 0; display: flex; align-items: center; gap: 10px;">
                  <el-button @click="goBackFromMonitor" :icon="ArrowLeft" circle></el-button>
                  <h3 style="margin: 0;">{{ isViewingHistory ? '历史思维回溯' : '实时思维监控' }}</h3>
               </div>
               <div style="flex: 1; overflow: hidden; border: 1px solid #eee; border-radius: 8px;">
                 <ReActProcessViewer 
                   :segments="isViewingHistory ? historySegments : monitorSegments" 
                   :isLive="!isViewingHistory"
                 />
               </div>
            </div>

            <!-- 2. 对话日志 -->
            <div v-show="currentTab === 'logs'" key="logs" class="view-container logs-layout">
              <el-card shadow="never" class="glass-card filter-card">
                <el-form :inline="true" size="default">
                  <el-form-item label="来源">
                    <el-select v-model="selectedSource" @change="fetchLogs" style="width: 120px">
                      <el-option label="Desktop" value="desktop" />
                      <el-option label="Mobile" value="mobile" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="会话">
                    <el-select v-model="selectedSessionId" @change="fetchLogs" style="width: 160px" allow-create filterable default-first-option placeholder="选择或输入ID">
                      <el-option label="默认会话 (Text)" value="default" />
                      <el-option label="语音会话 (Voice)" value="voice_session" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="日期">
                    <el-date-picker
                      v-model="selectedDate"
                      type="date"
                      placeholder="选择日期"
                      format="YYYY-MM-DD"
                      value-format="YYYY-MM-DD"
                      @change="fetchLogs"
                      style="width: 140px"
                      clearable
                    />
                  </el-form-item>
                  <el-form-item label="排序">
                    <el-select v-model="selectedSort" @change="fetchLogs" style="width: 100px">
                      <el-option label="正序" value="asc" />
                      <el-option label="倒序" value="desc" />
                    </el-select>
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" :icon="Refresh" @click="fetchLogs" :loading="isLogsFetching" circle></el-button>
                  </el-form-item>
                </el-form>
              </el-card>

              <div class="chat-scroll-area">
                <el-empty v-if="logs.length === 0" description="暂无对话记录" />
                <div 
                  v-for="log in logs" 
                  :key="log.id" 
                  class="chat-bubble-wrapper"
                  :class="[
                    log.role === 'user' ? 'user' : 'assistant',
                    { 'editing': editingLogId === log.id }
                  ]"
                >
                  <div class="avatar">
                    {{ log.role === 'user' ? '👤' : '🎀' }}
                  </div>
                  <div class="bubble-content-box">
                    <div class="bubble-meta">
                      <span class="role-name">{{ log.role === 'user' ? 'You' : 'Pero' }}</span>
                      <span class="time">{{ log.displayTime }}</span>
                      
                      <!-- 消息元数据指示器 -->
                      <span v-if="log.sentiment && log.sentiment !== 'neutral'" class="log-meta-tag" :title="`情感: ${log.sentiment}`">
                        {{ getSentimentEmoji(log.sentiment) }}
                      </span>
                      <span v-if="log.importance > 1" class="log-meta-tag importance" :title="`重要度: ${log.importance}`">
                        ⭐{{ log.importance }}
                      </span>
                      <span v-if="log.metadata.memory_extracted || log.memory_id" class="log-meta-tag memory" title="此对话已提取为核心记忆">
                        🧠
                      </span>

                      <!-- Scorer 状态 -->
                      <span v-if="log.analysis_status === 'processing'" class="log-meta-tag processing" title="秘书正在分析..." style="color: #409eff;">
                        <el-icon class="is-loading"><Loading /></el-icon>
                      </span>
                      <el-tooltip v-if="log.analysis_status === 'failed'" :content="log.last_error || '分析失败'" placement="top">
                        <span class="log-meta-tag failed" style="color: #f56c6c; cursor: help;">
                          <el-icon><Warning /></el-icon>
                        </span>
                      </el-tooltip>
                    </div>
                    
                    <div v-if="editingLogId === log.id" class="edit-mode">
                      <el-input 
                        v-model="editingContent" 
                        type="textarea" 
                        :autosize="{ minRows: 6, maxRows: 20 }"
                        resize="none"
                        class="dashboard-edit-textarea"
                      />
                      <div class="edit-tools">
                        <el-button size="small" type="primary" @click="saveLogEdit(log.id)">保存</el-button>
                        <el-button size="small" @click="cancelLogEdit">取消</el-button>
                      </div>
                    </div>
                    
                    <div v-else class="message-content-wrapper">
                      <AsyncMarkdown :content="log.content" />
                    </div>
                    
                    <div class="bubble-actions">
                      <el-button 
                        v-if="log.analysis_status === 'failed'" 
                        link 
                        :icon="RefreshRight"
                        @click="retryLogAnalysis(log)" 
                        size="small" 
                        style="color: #e6a23c;"
                      >
                        重试 ({{ log.retry_count }})
                      </el-button>
                      <el-button link :icon="Monitor" @click="openHistoryMonitor(log)" size="small" style="color: #626aef;">思维链</el-button>
                      <el-button link :icon="Edit" @click="startLogEdit(log)" size="small">编辑</el-button>
                      <el-button link :icon="Delete" @click="deleteLog(log.id)" size="small" style="color: #f56c6c;">删除</el-button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. 核心记忆 (Refactored) -->
            <div v-show="currentTab === 'memories'" key="memories" class="view-container">
              <div class="toolbar memory-toolbar">
                 <h3 class="section-title">长期记忆库 (Long-term Memory)</h3>
                 <div class="filters">
                    <el-date-picker
                        v-model="memoryFilterDate"
                        type="date"
                        placeholder="按日期筛选"
                        value-format="YYYY-MM-DD"
                        size="small"
                        @change="fetchMemories"
                    />
                    <el-radio-group v-model="memoryViewMode" size="small" @change="val => { if(val==='graph') fetchMemoryGraph() }">
                        <el-radio-button label="list">列表</el-radio-button>
                        <el-radio-button label="graph">图谱</el-radio-button>
                    </el-radio-group>
                 </div>
              </div>

              <!-- Tag Cloud Area -->
              <div class="tag-cloud-area" v-if="topTags.length">
                  <span class="tag-cloud-label">热门标签:</span>
                  <div class="tag-cloud-chips">
                      <el-check-tag 
                        v-for="{ tag, count } in topTags" 
                        :key="tag"
                        :checked="memoryFilterTags.includes(tag)"
                        @change="checked => { 
                            if(checked) memoryFilterTags.push(tag); 
                            else memoryFilterTags = memoryFilterTags.filter(t => t !== tag);
                            fetchMemories();
                        }"
                        class="cloud-tag"
                      >
                        {{ tag }} ({{ count }})
                      </el-check-tag>
                  </div>
              </div>

              <!-- List Mode -->
              <div v-show="memoryViewMode === 'list'" class="memory-waterfall">
                <div v-for="m in memories" :key="m.id" class="memory-item">
                  <el-card shadow="hover" class="memory-card" :class="m.type">
                    <div class="memory-top">
                      <div class="badges-left">
                        <el-tag :type="getMemoryTagType(m.type)" effect="dark" size="small" round>
                           {{ getMemoryTypeLabel(m.type) }}
                        </el-tag>
                        <el-tag v-if="m.sentiment && m.sentiment !== 'neutral'" type="info" effect="plain" size="small" round>
                          {{ getSentimentEmoji(m.sentiment) }}
                        </el-tag>
                      </div>
                      <div class="actions-right">
                        <span class="importance-indicator" :title="`Base: ${m.base_importance}`">
                          ⭐ {{ m.importance }}
                        </span>
                        <span class="access-indicator" title="被回忆次数">
                          🔥 {{ m.access_count || 0 }}
                        </span>
                        <el-button type="danger" link :icon="Delete" @click="deleteMemory(m.id)" circle size="small"></el-button>
                      </div>
                    </div>
                    
                    <div class="memory-text">{{ m.content }}</div>
                    
                    <div class="memory-bottom">
                      <div class="tags-row">
                        <el-tag 
                          v-for="t in (m.tags ? m.tags.split(',') : [])" 
                          :key="t" 
                          size="small" 
                          effect="plain"
                          class="mini-tag"
                        >
                          {{ t }}
                        </el-tag>
                      </div>
                      <div class="time-hint">{{ m.realTime }}</div>
                    </div>
                  </el-card>
                </div>
              </div>

              <!-- Graph Mode -->
              <div v-show="memoryViewMode === 'graph'" class="memory-graph-container" v-loading="isLoadingGraph">
                 <div class="graph-placeholder" v-if="memoryGraphData.nodes.length === 0">
                    <el-empty description="暂无关联数据或数据量过少" />
                 </div>
                 <div v-else class="simple-graph-view" style="display: flex; gap: 20px; background: #fafafa; padding: 10px;">
                    <div ref="graphRef" style="flex: 1; height: 500px; border-radius: 8px; overflow: hidden; border: 1px solid #eee;"></div>
                    
                    <div class="graph-legend-panel" style="width: 240px; padding: 15px; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05); overflow-y: auto;">
                        <h4 style="margin: 0 0 15px 0; color: #303133; font-size: 15px;">图谱图例说明</h4>
                        
                        <div style="margin-bottom: 15px;">
                            <div style="font-weight: bold; font-size: 13px; margin-bottom: 5px; color: #606266;">🧠 节点 (Node)</div>
                            <div style="font-size: 12px; color: #909399; line-height: 1.5;">代表一个独立的记忆片段。颜色代表情感，节点大小代表重要度。</div>
                        </div>

                        <div style="margin-bottom: 15px;">
                             <div style="font-weight: bold; font-size: 13px; margin-bottom: 5px; color: #606266;">🔗 连线 (Edge)</div>
                             <div style="font-size: 12px; color: #909399; line-height: 1.5;">代表记忆之间的逻辑关联。</div>
                        </div>

                        <div style="margin-bottom: 15px;">
                             <div style="font-weight: bold; font-size: 13px; margin-bottom: 5px; color: #606266;">🎨 情感 (Sentiment)</div>
                             <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                                <el-tag size="small" type="success" effect="dark">正面</el-tag>
                                <el-tag size="small" type="danger" effect="dark">负面</el-tag>
                                <el-tag size="small" type="info" effect="dark">中性</el-tag>
                             </div>
                        </div>

                         <div style="margin-bottom: 15px;">
                             <div style="font-weight: bold; font-size: 13px; margin-bottom: 5px; color: #606266;">⭐ 重要度 (Importance)</div>
                             <div style="font-size: 12px; color: #909399; line-height: 1.5;">1-10分，分数越高越不易遗忘。</div>
                        </div>
                        
                        <div style="margin-bottom: 15px;">
                             <div style="font-weight: bold; font-size: 13px; margin-bottom: 5px; color: #606266;">🔥 活跃度 (Access)</div>
                             <div style="font-size: 12px; color: #909399; line-height: 1.5;">记忆被唤醒和引用的次数。</div>
                        </div>

                        <div class="graph-hint-mini" style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px;">
                            <p style="margin: 0; font-size: 12px; color: #909399;">当前节点: {{ memoryGraphData.nodes.length }}</p>
                            <p style="margin: 5px 0 0 0; font-size: 12px; color: #909399;">当前连线: {{ memoryGraphData.edges.length }}</p>
                        </div>
                    </div>
                 </div>
              </div>
            </div>

            <!-- 4. 待办任务 -->
            <div v-show="currentTab === 'tasks'" key="tasks" class="view-container">
               <div class="toolbar">
                 <h3 class="section-title">待办与计划列表</h3>
               </div>

               <div class="task-waterfall">
                 <div v-for="task in tasks" :key="task.id" class="task-item">
                   <el-card shadow="hover" class="task-card-modern" :class="task.type">
                     <div class="task-top">
                       <el-tag :type="task.type === 'reminder' ? 'danger' : 'primary'" effect="light" size="small" round>
                          {{ task.type === 'reminder' ? '⏰ 提醒' : '💡 话题' }}
                       </el-tag>
                       <el-button type="danger" link :icon="Delete" @click="deleteTask(task.id)" circle size="small"></el-button>
                     </div>
                     
                     <div class="task-content">{{ task.content }}</div>
                     
                     <div class="task-bottom">
                       <div class="task-time">
                         <el-icon><Calendar /></el-icon>
                         <span>{{ new Date(task.time).toLocaleString() }}</span>
                       </div>
                     </div>
                   </el-card>
                 </div>
               </div>
               <el-empty v-if="tasks.length === 0" description="暂无待办任务" />
            </div>

            <!-- 5. 模型配置 -->
            <div v-show="currentTab === 'model_config'" key="model_config" class="view-container">
              <div class="toolbar">
                <el-button @click="openGlobalSettings">🌍 全局服务商配置</el-button>
                <el-button type="primary" :icon="Edit" @click="openModelEditor(null)">添加模型</el-button>
              </div>

              <div class="models-grid-layout">
                <el-card 
                  v-for="model in models" 
                  :key="model.id" 
                  class="model-config-card" 
                  :class="{ 
                    'active-main': currentActiveModelId === model.id,
                    'active-secretary': secretaryModelId === model.id,
                    'active-reflection': reflectionModelId === model.id
                  }"
                  shadow="hover"
                >
                  <div class="model-header">
                    <h3>{{ model.name }}</h3>
                    <div class="badges">
                       <el-tag v-if="model.enable_vision" type="success" size="small">视觉</el-tag>
                       <el-tag v-if="model.enable_voice" type="warning" size="small">语音</el-tag>
                       <el-tag v-if="model.enable_video" type="danger" size="small">视频</el-tag>
                       <el-tag v-if="currentActiveModelId === model.id" effect="dark" color="#ff88aa" style="border:none; color:white;">主模型</el-tag>
                       <el-tag v-if="secretaryModelId === model.id" type="warning" size="small">秘书</el-tag>
                       <el-tag v-if="reflectionModelId === model.id" type="danger" size="small">反思</el-tag>
                       <el-tag v-if="auxModelId === model.id" type="info" size="small">辅助</el-tag>
                    </div>
                  </div>
                  <div class="model-body">
                    <p><strong>ID:</strong> {{ model.model_id }}</p>
                    <p><strong>Provider:</strong> <el-tag size="small" :type="model.provider === 'gemini' ? 'info' : (model.provider === 'anthropic' ? 'warning' : 'success')">{{ model.provider || 'openai' }}</el-tag></p>
                    <p><strong>Temp:</strong> {{ model.temperature }}</p>
                    <p><strong>Source:</strong> {{ model.provider_type === 'global' ? 'Global' : 'Custom' }}</p>
                  </div>
                  <div class="model-actions">
                    <el-button-group class="action-group">
                       <el-button 
                        size="small" 
                        :type="currentActiveModelId === model.id ? 'success' : 'default'"
                        :disabled="currentActiveModelId === model.id"
                        @click="activateModel(model.id, 'current_model_id')"
                       >
                         主模型
                       </el-button>
                       <el-button 
                        size="small" 
                        :type="secretaryModelId === model.id ? 'warning' : 'default'"
                        @click="secretaryModelId === model.id ? activateModel(null, 'scorer_model_id') : activateModel(model.id, 'scorer_model_id')"
                       >
                         秘书
                       </el-button>
                       <el-button 
                        size="small" 
                        :type="reflectionModelId === model.id ? 'danger' : 'default'"
                        @click="reflectionModelId === model.id ? activateModel(null, 'reflection_model_id') : activateModel(model.id, 'reflection_model_id')"
                       >
                         反思
                       </el-button>
                       <el-button 
                        size="small" 
                        :type="auxModelId === model.id ? 'info' : 'default'"
                        @click="auxModelId === model.id ? activateModel(null, 'aux_model_id') : activateModel(model.id, 'aux_model_id')"
                       >
                         辅助
                       </el-button>
                    </el-button-group>
                    <div class="utils-group">
                      <el-button circle :icon="Edit" size="small" @click="openModelEditor(model)"></el-button>
                      <el-button circle :icon="Delete" size="small" type="danger" @click="deleteModel(model.id)" :disabled="currentActiveModelId === model.id"></el-button>
                    </div>
                  </div>
                </el-card>
              </div>
            </div>

            <!-- 6. 语音功能 -->
            <div v-show="currentTab === 'voice_config'" key="voice_config" class="view-container">
              <VoiceConfigPanel />
            </div>

            <!-- 7. MCP 配置 -->
            <div v-show="currentTab === 'mcp_config'" key="mcp_config" class="view-container">
               <div class="toolbar">
                <el-button type="primary" :icon="Connection" @click="openMcpEditor(null)">添加 MCP 服务器</el-button>
              </div>
              <el-row :gutter="20">
                <el-col v-for="mcp in mcps" :key="mcp.id" :xs="24" :sm="12" :md="8">
                  <el-card class="mcp-card-modern" :class="{ disabled: !mcp.enabled }" shadow="hover">
                    <div class="mcp-header">
                      <div class="mcp-title">{{ mcp.name }}</div>
                      <el-switch 
                        v-model="mcp.enabled" 
                        @change="() => toggleMcpEnabled(mcp)"
                        inline-prompt
                        active-text="ON"
                        inactive-text="OFF"
                      />
                    </div>
                    <div class="mcp-info">
                      <el-tag size="small" :type="mcp.type === 'stdio' ? 'info' : 'primary'">{{ mcp.type.toUpperCase() }}</el-tag>
                      <div class="mcp-detail">
                        {{ mcp.type === 'stdio' ? mcp.command : mcp.url }}
                      </div>
                    </div>
                    <div class="mcp-footer">
                      <el-button link :icon="Edit" @click="openMcpEditor(mcp)">配置</el-button>
                      <el-button link :icon="Delete" type="danger" @click="deleteMcp(mcp.id)">删除</el-button>
                    </div>
                  </el-card>
                </el-col>
              </el-row>
            </div>

            <!-- 8. 用户设定 -->
            <div v-show="currentTab === 'user_settings'" key="user_settings" class="view-container">
              <el-card shadow="never" class="glass-card">
                <template #header>
                  <div class="card-header">
                    <span>主人身份设定</span>
                  </div>
                </template>
                <el-form label-position="top">
                  <el-form-item label="主人的名字 (Owner Name)">
                    <el-input v-model="userSettings.owner_name" placeholder="Pero 对你的称呼" />
                  </el-form-item>
                  <el-form-item label="主人的人设信息 (Owner Persona)">
                    <el-input 
                      v-model="userSettings.user_persona" 
                      type="textarea" 
                      :rows="6" 
                      placeholder="描述一下你自己，比如你的性格、职业、与 Pero 的关系等。这些信息会帮助 Pero 更好地了解你并调整交流方式。" 
                    />
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" :loading="isSaving" @click="saveUserSettings">保存设定</el-button>
                  </el-form-item>
                </el-form>
              </el-card>
            </div>

            <!-- 9. 恢复出厂设置 -->
            <div v-show="currentTab === 'system_reset'" key="system_reset" class="view-container">
              <el-card shadow="never" class="glass-card danger-card">
                <template #header>
                  <div class="card-header">
                    <span style="color: #f56c6c; font-weight: bold;">⚠️ 恢复出厂设置 (Factory Reset)</span>
                  </div>
                </template>
                <div class="danger-content">
                  <p>此操作将执行以下清理：</p>
                  <ul>
                    <li>清除所有<strong>长期记忆</strong> (Memories)</li>
                    <li>清除所有<strong>对话历史</strong> (Conversation Logs)</li>
                    <li>重置 Pero 的<strong>状态与情绪</strong> (Pet State)</li>
                    <li>清除所有<strong>待办提醒与话题</strong> (Tasks)</li>
                    <li>重置<strong>主人设定</strong> (Owner Persona)</li>
                  </ul>
                  <p style="margin-top: 15px; color: #909399;">注：模型 API 配置、语音配置、MCP 配置将被保留。</p>
                  
                  <div style="margin-top: 30px;">
                    <el-button type="danger" size="large" @click="handleSystemReset" :loading="isSaving">
                      立即恢复出厂设置
                    </el-button>
                  </div>
                </div>
              </el-card>
            </div>

          </div>
        </el-main>
    </el-container>
  </el-container>

    <!-- Dialogs -->
    <el-dialog v-model="showGlobalSettings" title="全局服务商配置" width="500px" center>
      <el-form label-position="top">
        <el-form-item label="API Key">
          <el-input v-model="globalConfig.global_llm_api_key" type="password" show-password />
        </el-form-item>
        <el-form-item label="API Base URL">
          <el-input v-model="globalConfig.global_llm_api_base" placeholder="https://api.openai.com" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGlobalSettings = false">取消</el-button>
        <el-button type="primary" @click="saveGlobalSettings" :loading="isSaving">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showModelEditor" :title="currentEditingModel.id ? '编辑模型' : '添加模型'" width="600px">
      <el-form label-width="120px">
        <el-form-item label="显示名称">
          <el-input v-model="currentEditingModel.name" placeholder="例如：GPT-4o" />
        </el-form-item>
        <el-form-item label="服务商 (Provider)">
          <el-select v-model="currentEditingModel.provider" placeholder="选择服务商" style="width:100%">
            <el-option label="OpenAI (兼容)" value="openai" />
            <el-option label="Gemini (原生)" value="gemini" />
            <el-option label="Claude (Anthropic)" value="anthropic" />
          </el-select>
        </el-form-item>
        <el-form-item label="Model ID">
          <div style="display:flex; gap:10px; width: 100%;">
            <el-input v-model="currentEditingModel.model_id" placeholder="gpt-4" />
            <el-button @click="fetchRemoteModels" :loading="isFetchingRemote">获取列表</el-button>
          </div>
          <el-select v-if="remoteModels.length" v-model="currentEditingModel.model_id" placeholder="选择获取到的模型" style="width:100%; margin-top:5px;">
            <el-option v-for="m in remoteModels" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="配置来源">
          <el-radio-group v-model="currentEditingModel.provider_type">
            <el-radio label="global">全局继承</el-radio>
            <el-radio label="custom">独立配置</el-radio>
          </el-radio-group>
        </el-form-item>
        
        <div v-if="currentEditingModel.provider_type === 'custom'" class="sub-form">
          <el-form-item label="API Key">
             <el-input v-model="currentEditingModel.api_key" type="password" />
          </el-form-item>
          <el-form-item label="Base URL">
             <el-input v-model="currentEditingModel.api_base" />
          </el-form-item>
        </div>

        <el-divider content-position="left">参数设置</el-divider>
        
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="Temperature">
              <el-input-number v-model="currentEditingModel.temperature" :step="0.1" :min="0" :max="2" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
             <el-form-item label="Max Tokens">
              <el-input-number v-model="currentEditingModel.max_tokens" :step="100" />
            </el-form-item>
          </el-col>
        </el-row>
        
        <el-form-item>
           <el-checkbox v-model="currentEditingModel.stream">开启流式传输 (Stream)</el-checkbox>
           <div style="display:flex; gap:10px; flex-wrap:wrap;">
             <el-checkbox v-model="currentEditingModel.enable_vision">视觉模态</el-checkbox>
             <el-checkbox v-model="currentEditingModel.enable_voice">语音模态 (Input)</el-checkbox>
             <el-checkbox v-model="currentEditingModel.enable_video">视频模态</el-checkbox>
           </div>
        </el-form-item>

      </el-form>
      <template #footer>
        <el-button @click="showModelEditor = false">取消</el-button>
        <el-button type="primary" @click="saveModel" :loading="isSaving">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showMcpEditor" :title="currentEditingMcp.id ? '编辑 MCP' : '添加 MCP'" width="600px">
      <el-form label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="currentEditingMcp.name" />
        </el-form-item>
        <el-form-item label="类型">
           <el-select v-model="currentEditingMcp.type">
             <el-option label="Stdio (本地)" value="stdio" />
             <el-option label="SSE (远程)" value="sse" />
           </el-select>
        </el-form-item>
        
        <template v-if="currentEditingMcp.type === 'stdio'">
           <el-form-item label="命令">
             <el-input v-model="currentEditingMcp.command" placeholder="node, python..." />
           </el-form-item>
           <el-form-item label="参数 (JSON)">
             <el-input v-model="currentEditingMcp.args" type="textarea" :rows="2" placeholder='["arg1", "arg2"]' />
           </el-form-item>
           <el-form-item label="环境变量">
             <el-input v-model="currentEditingMcp.env" type="textarea" :rows="2" placeholder='{"KEY": "VALUE"}' />
           </el-form-item>
        </template>
        
        <template v-if="currentEditingMcp.type === 'sse'">
           <el-form-item label="URL">
             <el-input v-model="currentEditingMcp.url" />
           </el-form-item>
        </template>

        <el-form-item>
           <el-switch v-model="currentEditingMcp.enabled" active-text="启用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showMcpEditor = false">取消</el-button>
        <el-button type="primary" @click="saveMcp" :loading="isSaving">保存</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import { ref, shallowRef, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import VoiceConfigPanel from './VoiceConfigPanel.vue'
import ReActProcessViewer from '../components/ReActProcessViewer.vue'
import AsyncMarkdown from '../components/AsyncMarkdown.vue'
import { marked } from 'marked'
import dompurify from 'dompurify'
import * as echarts from 'echarts'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Menu as IconMenu,
  ChatLineRound,
  Cpu,
  Bell,
  SetUp,
  Connection,
  Refresh,
  Edit,
  Delete,
  Search,
  Check,
  Close,
  MoreFilled,
  User,
  SwitchButton,
  Microphone,
  Warning,
  ArrowLeft
} from '@element-plus/icons-vue'

// 为了防止在非 Tauri 环境下报错，定义一个 fallback 的 listen
const listenSafe = (event, callback) => {
  if (window.__TAURI__) {
    return listen(event, callback)
  }
  return Promise.resolve(() => {})
}

// --- 状态管理 ---
const currentTab = ref('overview')
const handleTabSelect = (index) => {
  if (currentTab.value === index) return
  currentTab.value = index
}
const isBackendOnline = ref(false)
const isSaving = ref(false)
const isGlobalRefreshing = ref(false)
const isCompanionEnabled = ref(false)
const isTogglingCompanion = ref(false)
const isSocialEnabled = ref(false)
const isTogglingSocial = ref(false)
const isLightweightEnabled = ref(false)
const isTogglingLightweight = ref(false)
const isAuraVisionEnabled = ref(false)
const isTogglingAuraVision = ref(false)
const isLogsFetching = ref(false)

// 编辑日志状态
const editingLogId = ref(null)
const editingContent = ref('')

// 数据源
const memories = shallowRef([])
const logs = shallowRef([])
const tasks = shallowRef([])
const petState = ref({})
const userSettings = ref({
  owner_name: '主人',
  user_persona: '未设定'
})

// 筛选条件
const selectedSource = ref('desktop')
const selectedSessionId = ref('') 
const selectedDate = ref('')
const selectedSort = ref('desc')

// --- ReAct Monitor State ---
const monitorSegments = ref([])
const historySegments = ref([])
const isViewingHistory = ref(false)

const parseReActSegments = (text) => {
  if (!text) return []
  const segments = []
  // 增加对标准 Thought: 和 Action: 格式的支持
  const regex = /(?:【(Thinking|Error|Reflection)[:：]?\s*([\s\S]*?)】)|(?:\n|^)\s*\*([^\*\n]+)\*|(?:\n|^)\s*(Thought|Action)[:：]\s*([^\n]+)/gi
  
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const normalText = text.substring(lastIndex, match.index)
      if (normalText.trim()) segments.push({ type: 'text', content: normalText })
    }
    
    if (match[1] !== undefined) {
        // Tagged block (Thinking/Error/Reflection)
        const type = match[1].toLowerCase()
        segments.push({ type, content: match[2].trim() })
    } else if (match[3] !== undefined) {
        // Action block (*Action*)
        segments.push({ type: 'action', content: match[3].trim() })
    } else if (match[4] !== undefined) {
        // Standard ReAct block (Thought:/Action:)
        const type = match[4].toLowerCase() === 'thought' ? 'thinking' : 'action'
        segments.push({ type, content: match[5].trim() })
    }
    
    lastIndex = regex.lastIndex
  }
  
  if (lastIndex < text.length) {
    const normalText = text.substring(lastIndex)
    if (normalText.trim()) segments.push({ type: 'text', content: normalText })
  }
  
  return segments
}

const openLiveMonitor = () => {
  currentTab.value = 'task_monitor'
  isViewingHistory.value = false
}

const openHistoryMonitor = (log) => {
  currentTab.value = 'task_monitor'
  isViewingHistory.value = true
  historySegments.value = parseReActSegments(log.content)
}

const goBackFromMonitor = () => {
  if (isViewingHistory.value) {
    currentTab.value = 'logs'
  } else {
    currentTab.value = 'overview'
  }
}


// --- System Monitor State ---
const systemStatus = ref(null)
const systemStatusInterval = ref(null)
const cpuColor = [
  { color: '#a0c4ff', percentage: 40 },
  { color: '#ffcc99', percentage: 80 },
  { color: '#ff88aa', percentage: 100 },
]
const memColor = [
  { color: '#a8e6cf', percentage: 40 },
  { color: '#ffcc99', percentage: 80 },
  { color: '#ff88aa', percentage: 100 },
]
const diskColor = [
  { color: '#b8c6db', percentage: 60 },
  { color: '#ff88aa', percentage: 90 },
]

// --- Refactored Memory Dashboard State ---
const nitStatus = ref(null)
const memoryViewMode = ref('list') // 'list' or 'graph'
const memoryGraphData = shallowRef({ nodes: [], edges: [] })
const tagCloud = ref({})
const memoryFilterTags = ref([])
const memoryFilterDate = ref(null)
const isLoadingGraph = ref(false)
const graphRef = ref(null)
let chartInstance = null
let resizeHandler = null

watch(memoryViewMode, (val) => {
    if (val === 'graph') {
        nextTick(() => {
            if (memoryGraphData.value.nodes.length > 0) {
                initGraph()
            } else {
                fetchMemoryGraph()
            }
        })
    } else {
        // Dispose chart when switching back to list mode to save memory
        if (chartInstance) {
            chartInstance.dispose()
            chartInstance = null
        }
    }
})

// 监听标签页切换，动态加载数据
watch(currentTab, (newTab) => {
  if (newTab === 'logs') {
    if (logs.value.length === 0) {
      initSessionAndFetchLogs()
    }
  } else if (newTab === 'memories') {
    if (memories.value.length === 0) {
      fetchMemories()
    }
  } else if (newTab === 'tasks') {
    if (tasks.value.length === 0) {
      fetchTasks()
    }
  }

  // Dispose graph when leaving memories tab
  if (newTab !== 'memories' && chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})

const topTags = computed(() => {
  if (!tagCloud.value) return []
  return Object.entries(tagCloud.value)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }))
})

const currentTabName = computed(() => {
  const map = {
    overview: '总览 (Overview)',
    logs: '对话日志 (Logs)',
    terminal: '系统终端 (Terminal)',
    memories: '核心记忆 (Memories)',
    tasks: '待办任务 (Tasks)',
    model_config: '模型配置 (Model Config)',
    voice_config: '语音配置 (Voice Config)',
    mcp_config: 'MCP 连接 (MCP Config)',
    user_settings: '用户设定 (User Settings)'
  }
  return map[currentTab.value] || 'Dashboard'
})

const getMemoryTagType = (type) => {
  if (type === 'preference') return 'danger'
  if (type === 'event' || type === 'summary' || type === 'interaction_summary') return 'primary'
  if (type === 'archived_event') return 'info'
  return 'info'
}

const getMemoryTypeLabel = (type) => {
  const map = {
    'event': '🧩 记忆块',
    'preference': '💖 偏好',
    'summary': '🧩 记忆块',
    'interaction_summary': '🧩 记忆块',
    'archived_event': '🗄️ 归档',
    'fact': '🧠 事实'
  }
  return map[type] || type
}

const getSentimentEmoji = (sentiment) => {
  if (!sentiment) return ''
  const map = {
    'positive': '😊',
    'negative': '😔',
    'neutral': '😐',
    'happy': '😄',
    'sad': '😢',
    'angry': '😠',
    'excited': '🤩'
  }
  return map[sentiment.toLowerCase()] || '😐'
}

const getLogMetadata = (log) => {
  try {
    return JSON.parse(log.metadata_json || '{}')
  } catch (e) {
    return {}
  }
}

// --- API 交互 ---
const API_BASE = 'http://localhost:9120/api'

// 带超时的 fetch 包装函数
const fetchWithTimeout = async (url, options = {}, timeout = 5000) => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    clearTimeout(id)
    return response
  } catch (error) {
    clearTimeout(id)
    // 只有当错误不是 AbortError 时才打印到 console.error
    // 这可以减少终端中因正常超时或取消导致的 Failed to fetch 报错
    if (error.name !== 'AbortError') {
      console.warn(`[Fetch] Request failed for ${url}:`, error.message)
    }
    throw error
  }
}

// 模型配置相关
const models = ref([])
const showGlobalSettings = ref(false)
const showModelEditor = ref(false)
const remoteModels = ref([])
const isFetchingRemote = ref(false)
const currentEditingModel = ref({})
const globalConfig = ref({ global_llm_api_key: '', global_llm_api_base: '' })

// MCP 配置相关
const mcps = ref([])
const showMcpEditor = ref(false)
const currentEditingMcp = ref({})
const currentActiveModelId = ref(null)
const secretaryModelId = ref(null)
const reflectionModelId = ref(null)
const auxModelId = ref(null)

// --- Methods ---

const checkBackendStatus = async () => {
  // 简单的单次检查，用于UI状态指示
  try {
    await fetchWithTimeout(`${API_BASE}/pet/state`, {}, 2000)
    isBackendOnline.value = true
  } catch (e) {
    isBackendOnline.value = false
  }
}

const waitForBackend = async () => {
  // 启动时的轮询等待
  const maxRetries = 60 // 等待60秒
  let retries = 0
  
  const check = async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/pet/state`, {}, 2000)
      if (res.ok) {
        isBackendOnline.value = true
        await fetchAllData() // 后端上线后，拉取所有数据
        return
      }
    } catch (e) {
      // 忽略启动时的连接错误，静默重试
    }
    
    if (retries < maxRetries) {
      retries++
      isBackendOnline.value = false
      setTimeout(check, 1000)
    } else {
      ElMessage.error('无法连接到 Pero 后端，请检查后台进程是否运行。')
    }
  }
  
  check()
}

const formatBytes = (bytes, decimals = 1) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const fetchSystemStatus = async () => {
    if (fetchSystemStatus.isPolling) return
    try {
        if (!isBackendOnline.value) return;
        fetchSystemStatus.isPolling = true
        const res = await fetchWithTimeout(`${API_BASE}/system/status`, {}, 2000)
        if (res.ok) {
            systemStatus.value = await res.json()
        }
    } catch(e) {
        // Silent fail for polling
    } finally {
        fetchSystemStatus.isPolling = false
    }
}

const fetchAllData = async () => {
  if (!isBackendOnline.value || isGlobalRefreshing.value) return
  
  isGlobalRefreshing.value = true
  // 1. 先加载核心状态，确保 UI 基础信息立即可用
  try {
    await Promise.all([
      fetchPetState(),
      fetchSystemStatus(),
      fetchConfig()
    ])
  } catch (e) { console.error('Core fetch error:', e) }

  // 2. 稍微延迟后加载次要配置，避免一次性涌入过多数据更新
  setTimeout(async () => {
    try {
      await Promise.all([
        fetchModels(),
        fetchMcps(),
        fetchCompanionStatus(),
        fetchSocialStatus(),
        fetchLightweightStatus(),
        fetchAuraVisionStatus(),
        fetchNitStatus()
      ])
    } catch (e) { console.error('Secondary fetch error:', e) }
  }, 100)

  // 3. 顺序加载所有标签页数据，确保 v-show 切换时内容已就绪
  setTimeout(async () => {
    try {
      // 1. 优先加载当前标签页数据
      if (currentTab.value === 'logs') await initSessionAndFetchLogs()
      if (currentTab.value === 'memories') await fetchMemories()
      if (currentTab.value === 'tasks') await fetchTasks()
      
      // 2. 异步加载其他标签页数据 (不使用 await 阻塞)
      if (currentTab.value !== 'logs') initSessionAndFetchLogs()
      if (currentTab.value !== 'memories') fetchMemories()
      if (currentTab.value !== 'tasks') fetchTasks()
      
      fetchTagCloud()
      ElMessage.success('所有数据已同步')
    } catch (e) { 
      console.error('Tab data fetch error:', e) 
      ElMessage.error('部分数据刷新失败')
    } finally {
      isGlobalRefreshing.value = false
    }
  }, 200)
}

const fetchNitStatus = async () => {
  if (fetchNitStatus.isLoading) return
  fetchNitStatus.isLoading = true
  try {
    const res = await fetchWithTimeout(`${API_BASE}/nit/status`, {}, 2000)
    nitStatus.value = await res.json()
  } catch (e) { 
    console.error(e) 
  } finally {
    fetchNitStatus.isLoading = false
  }
}

const fetchTagCloud = async () => {
    if (fetchTagCloud.isLoading) return
    fetchTagCloud.isLoading = true
    try {
        const res = await fetchWithTimeout(`${API_BASE}/memories/tags`, {}, 3000)
        tagCloud.value = await res.json()
    } catch(e) { 
        console.error(e) 
    } finally {
        fetchTagCloud.isLoading = false
    }
}

const fetchMemoryGraph = async () => {
    if (isLoadingGraph.value) return
    try {
        isLoadingGraph.value = true
        // 降低限制到 100 以提升性能，防止大规模节点渲染导致主线程阻塞
        const res = await fetchWithTimeout(`${API_BASE}/memories/graph?limit=100`, {}, 8000)
        const data = await res.json()
        
        // 确保在数据拉取后，且仍然在 memory 标签页时才初始化图表
        if (currentTab.value === 'memories') {
            memoryGraphData.value = Object.freeze(data) // Freeze data to avoid Vue reactivity overhead
            nextTick(() => {
                requestAnimationFrame(() => initGraph())
            })
        }
    } catch(e) { 
        console.error(e) 
    } finally { 
        isLoadingGraph.value = false 
    }
}

const initGraph = () => {
    if (!graphRef.value) return
    if (chartInstance) chartInstance.dispose()
    
    chartInstance = echarts.init(graphRef.value, 'dark') // Use dark theme base if available, or just manual colors
    
    const nodes = memoryGraphData.value.nodes.map(node => ({
        ...node,
        // Ensure name is string
        name: String(node.id),
        category: getMemoryTypeLabel(node.category),
        // Visual style based on sentiment/type
        itemStyle: {
            color: getSentimentColor(node.sentiment),
            shadowBlur: 10,
            shadowColor: getSentimentColor(node.sentiment)
        }
    }))
    
    const links = memoryGraphData.value.edges
    
    // Generate categories from data
    const categories = [...new Set(nodes.map(n => n.category))].map(c => ({ name: c }))

    const option = {
        backgroundColor: '#1a1a2e', // Deep space blue/black
        title: {
            text: '神经网络记忆图谱',
            subtext: '交互式知识图谱',
            top: 'bottom',
            left: 'right',
            textStyle: { color: '#fff' }
        },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                if (params.dataType === 'node') {
                    const d = params.data
                    return `
                        <div style="font-weight:bold; margin-bottom:5px;">${d.full_content.substring(0, 50)}...</div>
                        <div>类型: <span style="color:#ff88aa">${d.category}</span></div>
                        <div>情感: ${d.sentiment} ${getSentimentEmoji(d.sentiment)}</div>
                        <div>重要度: ${d.value}/10</div>
                        <div>活跃度: ${d.access_count}</div>
                        <div style="font-size:10px; color:#aaa; margin-top:5px;">${d.realTime}</div>
                    `
                } else {
                    return `${params.data.relation_type} (强度: ${params.data.value})`
                }
            }
        },
        legend: [{
            data: categories.map(a => a.name),
            textStyle: { color: '#ccc' },
            orient: 'vertical',
            left: 'left',
            top: 'center'
        }],
        series: [
            {
                type: 'graph',
                layout: 'force',
                data: nodes,
                links: links,
                categories: categories,
                roam: true,
                draggable: true,
                label: {
                    show: true,
                    position: 'right',
                    formatter: (p) => p.data.label && p.data.label.show ? p.data.label.formatter : '',
                    color: '#fff'
                },
                lineStyle: {
                    color: 'source',
                    curveness: 0.3
                },
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: {
                        width: 5
                    }
                },
                force: {
                    repulsion: 150,
                    gravity: 0.1,
                    edgeLength: [50, 200],
                    layoutAnimation: nodes.length < 100, // 节点过多时禁用初始动画以提升性能
                    friction: 0.6, // 增加摩擦力，让图形更快稳定
                    initLayout: 'circular' // 初始布局改为环形，减少力导向计算初期的剧烈抖动
                }
            }
        ],
        // 性能优化：渐进式渲染
        progressive: 500,
        progressiveThreshold: 1000
    }
    
    chartInstance.setOption(option)
    
    // 性能优化：在力导向布局稳定后停止计算
    if (nodes.length > 50) {
        setTimeout(() => {
            if (chartInstance) {
                chartInstance.setOption({
                    series: [{ force: { layoutAnimation: false } }]
                })
            }
        }, 3000)
    }
    
    // Resize handler
    if (resizeHandler) window.removeEventListener('resize', resizeHandler)
    resizeHandler = () => chartInstance && chartInstance.resize()
    window.addEventListener('resize', resizeHandler)
}

// Helper for colors
const getSentimentColor = (sentiment) => {
    const map = {
        'positive': '#67c23a', // green
        'negative': '#f56c6c', // red
        'neutral': '#a0c4ff', // blue
        'happy': '#e6a23c', // orange/yellow
        'sad': '#909399', // grey
        'angry': '#f56c6c',
        'excited': '#ff88aa' // pink
    }
    return map[sentiment] || '#a0c4ff'
}

const fetchCompanionStatus = async () => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/companion/status`, {}, 2000)
    if (res.ok) {
      const data = await res.json()
      isCompanionEnabled.value = data.enabled
    }
  } catch (e) {
    console.error('Failed to fetch companion status', e)
  }
}

const toggleCompanion = async (val) => {
  try {
    isTogglingCompanion.value = true
    const res = await fetchWithTimeout(`${API_BASE}/companion/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: val })
    }, 5000)
    
    if (res.ok) {
      const data = await res.json()
      isCompanionEnabled.value = data.enabled
      ElMessage.success(data.enabled ? '已开启陪伴模式' : '已关闭陪伴模式')
    } else {
      const errorData = await res.json()
      isCompanionEnabled.value = !val // revert
      ElMessage.warning(errorData.detail || '切换失败')
    }
  } catch (e) {
    isCompanionEnabled.value = !val // revert
    ElMessage.error('网络错误')
  } finally {
    isTogglingCompanion.value = false
  }
}

const fetchSocialStatus = async () => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/social/status`, {}, 2000)
    if (res.ok) {
      const data = await res.json()
      isSocialEnabled.value = data.enabled
    }
  } catch (e) {
    console.error('Failed to fetch social status', e)
  }
}

const toggleSocial = async (val) => {
  try {
    isTogglingSocial.value = true
    const res = await fetchWithTimeout(`${API_BASE}/social/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: val })
    }, 5000)
    
    if (res.ok) {
      const data = await res.json()
      isSocialEnabled.value = data.enabled
      ElMessage.success(data.enabled ? '已开启社交模式' : '已关闭社交模式')
    } else {
      isSocialEnabled.value = !val // revert
      ElMessage.error('切换失败')
    }
  } catch (e) {
    isSocialEnabled.value = !val // revert
    ElMessage.error('网络错误')
  } finally {
    isTogglingSocial.value = false
  }
}

const fetchLightweightStatus = async () => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/config/lightweight_mode`, {}, 2000)
    if (res.ok) {
      const data = await res.json()
      isLightweightEnabled.value = data.enabled
    }
  } catch (e) {
    console.error('Failed to fetch lightweight status', e)
  }
}

const toggleLightweight = async (val) => {
  try {
    isTogglingLightweight.value = true
    const res = await fetchWithTimeout(`${API_BASE}/config/lightweight_mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: val })
    }, 5000)
    
    if (res.ok) {
      const data = await res.json()
      isLightweightEnabled.value = data.enabled
      ElMessage.success(data.enabled ? '已开启轻量聊天模式' : '已关闭轻量聊天模式')
    } else {
      isLightweightEnabled.value = !val // revert
      ElMessage.error('切换失败')
    }
  } catch (e) {
    isLightweightEnabled.value = !val // revert
    ElMessage.error('网络错误')
  } finally {
    isTogglingLightweight.value = false
  }
}

const fetchAuraVisionStatus = async () => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/config/aura_vision`, {}, 3000)
    if (res.ok) {
      const data = await res.json()
      isAuraVisionEnabled.value = data.enabled
    }
  } catch (e) {
    console.error('Failed to fetch AuraVision status', e)
  }
}

const toggleAuraVision = async (val) => {
  try {
    isTogglingAuraVision.value = true
    const res = await fetchWithTimeout(`${API_BASE}/config/aura_vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: val })
    }, 5000)
    
    if (res.ok) {
      const data = await res.json()
      isAuraVisionEnabled.value = data.enabled
      ElMessage.success(data.enabled ? '已开启主动视觉感应 (AuraVision)' : '已关闭主动视觉感应 (AuraVision)')
    } else {
      isAuraVisionEnabled.value = !val // revert
      ElMessage.error('切换失败')
    }
  } catch (e) {
    isAuraVisionEnabled.value = !val // revert
    ElMessage.error('网络错误')
  } finally {
    isTogglingAuraVision.value = false
  }
}

// 退出程序
const handleQuitApp = () => {
  ElMessageBox.confirm(
    '确定要关闭 Pero 并退出所有相关程序吗？',
    '退出 PeroCore',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(async () => {
    try {
      if (window.__TAURI__) {
        const invoke = window.__TAURI__.core?.invoke || window.__TAURI__.invoke
        await invoke('quit_app')
      } else {
        ElMessage.error('非 Tauri 环境，无法执行退出')
      }
    } catch (e) {
      console.error('Failed to quit app', e)
    }
  }).catch(() => {})
}

const fetchMcps = async () => {
  if (fetchMcps.isLoading) return
  fetchMcps.isLoading = true
  try {
    const res = await fetchWithTimeout(`${API_BASE}/mcp`, {}, 5000)
    mcps.value = await res.json()
  } catch (e) { 
    console.error(e) 
  } finally {
    fetchMcps.isLoading = false
  }
}

const fetchPetState = async () => {
  if (fetchPetState.isPolling) return
  try {
    if (!isBackendOnline.value) return;
    fetchPetState.isPolling = true
    const res = await fetchWithTimeout(`${API_BASE}/pet/state`, {}, 2000)
    if (res.ok) {
        petState.value = await res.json()
    }
  } catch (e) { 
    // Silent fail for polling, no need to log Failed to fetch
  } finally {
    fetchPetState.isPolling = false
  }
}

const fetchMemories = async () => {
  if (fetchMemories.isLoading) return
  fetchMemories.isLoading = true

  const currentRequestId = Symbol('fetchMemories')
  fetchMemories.lastRequestId = currentRequestId

  try {
    let url = `${API_BASE}/memories/list?limit=100`
    if (memoryFilterDate.value) {
        url += `&date_start=${memoryFilterDate.value}`
    }
    if (memoryFilterTags.value.length > 0) {
        url += `&tags=${memoryFilterTags.value.join(',')}`
    }
    const res = await fetchWithTimeout(url, {}, 5000)
    const rawMemories = await res.json()
    
    // Process in larger batches to reduce Vue churn
    const processedMemories = []
    const batchSize = 50
    
    const processBatch = (startIndex) => {
      if (fetchMemories.lastRequestId !== currentRequestId || currentTab.value !== 'memories') {
        fetchMemories.isLoading = false
        return
      }

      const endIndex = Math.min(startIndex + batchSize, rawMemories.length)
      for (let i = startIndex; i < endIndex; i++) {
        const m = rawMemories[i]
        processedMemories.push(Object.freeze({
          ...m,
          realTime: new Date(m.timestamp).toLocaleDateString()
        }))
      }
      
      memories.value = [...processedMemories]
      
      if (endIndex < rawMemories.length) {
        setTimeout(() => processBatch(endIndex), 16) // Use 16ms to allow one frame of UI response
      } else {
        fetchMemories.isLoading = false
      }
    }
    
    processBatch(0)
    fetchTagCloud()
  } catch (e) { 
    console.error(e)
    fetchMemories.isLoading = false
  }
}

const fetchTasks = async () => {
  if (fetchTasks.isLoading) return
  fetchTasks.isLoading = true

  const currentRequestId = Symbol('fetchTasks')
  fetchTasks.lastRequestId = currentRequestId

  try {
    const res = await fetchWithTimeout(`${API_BASE}/tasks`, {}, 5000)
    const rawTasks = await res.json()
    
    // Process all at once if count is small (< 100), otherwise batch
    if (rawTasks.length < 100) {
        tasks.value = rawTasks.map(t => Object.freeze(t))
        fetchTasks.isLoading = false
        return
    }

    const processedTasks = []
    const batchSize = 20
    
    const processBatch = (startIndex) => {
      if (fetchTasks.lastRequestId !== currentRequestId) {
        fetchTasks.isLoading = false
        return
      }

      const endIndex = Math.min(startIndex + batchSize, rawTasks.length)
      for (let i = startIndex; i < endIndex; i++) {
        processedTasks.push(Object.freeze(rawTasks[i]))
      }
      
      tasks.value = [...processedTasks]
      
      if (endIndex < rawTasks.length) {
        setTimeout(() => processBatch(endIndex), 16)
      } else {
        fetchTasks.isLoading = false
      }
    }
    
    processBatch(0)
  } catch (e) { 
    console.error(e)
    fetchTasks.isLoading = false
  }
}

const fetchConfig = async () => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/configs`, {}, 5000)
    const data = await res.json()
    globalConfig.value.global_llm_api_key = data.global_llm_api_key || ''
    globalConfig.value.global_llm_api_base = data.global_llm_api_base || 'https://api.openai.com'
    currentActiveModelId.value = data.current_model_id ? parseInt(data.current_model_id) : null
    secretaryModelId.value = data.scorer_model_id ? parseInt(data.scorer_model_id) : null
    reflectionModelId.value = data.reflection_model_id ? parseInt(data.reflection_model_id) : null
    auxModelId.value = data.aux_model_id ? parseInt(data.aux_model_id) : null
    
    // 加载用户设定
    userSettings.value.owner_name = data.owner_name || '主人'
    userSettings.value.user_persona = data.user_persona || '未设定'
  } catch (e) { console.error(e) }
}

const fetchModels = async () => {
  if (fetchModels.isLoading) return
  fetchModels.isLoading = true
  try {
    const res = await fetchWithTimeout(`${API_BASE}/models`, {}, 5000)
    models.value = await res.json()
  } catch (e) { 
    console.error(e) 
  } finally {
    fetchModels.isLoading = false
  }
}

// Global Settings
const openGlobalSettings = () => { showGlobalSettings.value = true }
const saveGlobalSettings = async () => {
  if (isSaving.value) return
  try {
    isSaving.value = true
    await fetchWithTimeout(`${API_BASE}/configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(globalConfig.value)
    }, 5000)
    showGlobalSettings.value = false
    ElMessage.success('全局配置已保存')
    await fetchConfig()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    isSaving.value = false
  }
}

// User Settings Logic
const saveUserSettings = async () => {
  if (isSaving.value) return
  try {
    isSaving.value = true
    await fetchWithTimeout(`${API_BASE}/configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        owner_name: userSettings.value.owner_name,
        user_persona: userSettings.value.user_persona
      })
    }, 5000)
    ElMessage.success('用户设定已保存')
    await fetchConfig()
  } catch (e) {
    ElMessage.error('保存失败: ' + e.message)
  } finally {
    isSaving.value = false
  }
}

// System Reset Logic
const handleSystemReset = async () => {
  if (isSaving.value) return
  try {
    const { value, action } = await ElMessageBox.prompt(
      '<div class="danger-main-text">主人，真的要让 Pero 忘掉你吗？o(╥﹏╥)o</div>' +
      '<div class="danger-sub-text">（此操作将执行深度清理，如需继续，请在文本框中输入“我们还会再见的...”）</div>',
      '终极警告',
      {
        inputValue: '',
        inputPlaceholder: '请输入：我们还会再见的...',
        confirmButtonText: '确定重置',
        cancelButtonText: '取消',
        type: 'error',
        customClass: 'danger-reset-box',
        center: true,
        dangerouslyUseHTMLString: true,
      }
    )

    if (action === 'confirm') {
      if (String(value || '').trim() !== '我们还会再见的...') {
        ElMessage.error('输入不匹配，已取消')
        return
      }

      isSaving.value = true
      const res = await fetchWithTimeout(`${API_BASE}/system/reset`, { method: 'POST' }, 10000)
      
      if (res.ok) {
        ElMessage.success('系统已恢复出厂设置')
        // 刷新所有数据以同步 UI
        await fetchAllData()
        currentTab.value = 'overview'
      } else {
        const err = await res.json()
        throw new Error(err.detail || '重置失败')
      }
    }
  } catch (e) {
    if (e !== 'cancel' && e?.action !== 'cancel') {
      ElMessage.error(e.message || '重置过程中发生错误')
    }
  } finally {
    isSaving.value = false
  }
}

// MCP Logic
const openMcpEditor = (mcp) => {
  if (mcp) {
    currentEditingMcp.value = JSON.parse(JSON.stringify(mcp))
  } else {
    currentEditingMcp.value = {
      name: '', type: 'stdio', command: '', args: '[]', env: '{}', url: '', enabled: true
    }
  }
  showMcpEditor.value = true
}

const saveMcp = async () => {
  if (isSaving.value) return
  try {
    isSaving.value = true
    const mcp = currentEditingMcp.value
    const url = mcp.id ? `${API_BASE}/mcp/${mcp.id}` : `${API_BASE}/mcp`
    const method = mcp.id ? 'PUT' : 'POST'
    
    // Validate JSON
    if (mcp.type === 'stdio') {
      JSON.parse(mcp.args || '[]')
      JSON.parse(mcp.env || '{}')
    }

    const res = await fetchWithTimeout(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcp)
    }, 5000)
    
    if (!res.ok) throw new Error('保存失败')
    
    showMcpEditor.value = false
    await fetchMcps()
    ElMessage.success('MCP 配置已保存')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    isSaving.value = false
  }
}

const deleteMcp = async (id) => {
  if (!id || deleteMcp.isLoading) {
    if (!id) ElMessage.error('无效的MCP ID')
    return
  }

  try {
    const confirmed = await ElMessageBox.confirm('确定删除此 MCP 配置吗？', '警告', { 
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning' 
    }).then(() => true).catch(() => false)

    if (!confirmed) return

    deleteMcp.isLoading = true
    const res = await fetchWithTimeout(`${API_BASE}/mcp/${id}`, { method: 'DELETE' }, 5000)

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.message || '删除失败')
    }
    await fetchMcps()
    ElMessage.success('已删除')
  } catch (e) {
    console.error('Unexpected error in deleteMcp:', e)
    ElMessage.error('系统错误: ' + (e.message || '未知错误'))
  } finally {
    deleteMcp.isLoading = false
  }
}

const toggleMcpEnabled = async (mcp) => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/mcp/${mcp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...mcp, enabled: mcp.enabled }) // Element Plus switch updates v-model directly
    }, 5000)
    if (!res.ok) throw new Error('更新失败')
    await fetchMcps()
  } catch (e) {
    ElMessage.error(e.message)
    mcp.enabled = !mcp.enabled // revert
  }
}

// Model Logic
const openModelEditor = (model) => {
  remoteModels.value = []
  if (model) {
    currentEditingModel.value = {
      enable_vision: false, enable_voice: false, enable_video: false, stream: true, temperature: 0.7,
      provider: 'openai',
      ...JSON.parse(JSON.stringify(model))
    }
  } else {
    currentEditingModel.value = {
      name: '', model_id: '', provider_type: 'global', provider: 'openai',
      api_key: '', api_base: '', temperature: 0.7, stream: true,
      enable_vision: false, enable_voice: false, enable_video: false
    }
  }
  showModelEditor.value = true
}

const fetchRemoteModels = async () => {
  if (isFetchingRemote.value) return
  try {
    isFetchingRemote.value = true
    let apiKey = '', apiBase = ''
    if (currentEditingModel.value.provider_type === 'global') {
      apiKey = globalConfig.value.global_llm_api_key
      apiBase = globalConfig.value.global_llm_api_base
    } else {
      apiKey = currentEditingModel.value.api_key
      apiBase = currentEditingModel.value.api_base
    }
    
    if (!apiBase) {
      ElMessage.warning('请先配置 API Base URL')
      return
    }

    const res = await fetchWithTimeout(`${API_BASE}/models/remote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        api_key: apiKey, 
        api_base: apiBase,
        provider: currentEditingModel.value.provider || 'openai'
      })
    }, 10000)
    
    const data = await res.json()
    if (data.models?.length) {
      remoteModels.value = data.models
      ElMessage.success(`获取到 ${data.models.length} 个模型`)
    } else {
      ElMessage.warning('未找到模型或 API 不支持')
    }
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    isFetchingRemote.value = false
  }
}

const saveModel = async () => {
  if (isSaving.value) return
  try {
    isSaving.value = true
    const model = currentEditingModel.value
    const url = model.id ? `${API_BASE}/models/${model.id}` : `${API_BASE}/models`
    const method = model.id ? 'PUT' : 'POST'
    
    const res = await fetchWithTimeout(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(model)
    }, 5000)
    
    if (!res.ok) throw new Error('保存失败')
    
    showModelEditor.value = false
    await fetchModels()
    ElMessage.success('模型已保存')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    isSaving.value = false
  }
}

const deleteModel = async (id) => {
  if (!id || deleteModel.isLoading) {
    if (!id) ElMessage.error('无效的模型ID')
    return
  }

  try {
    const confirmed = await ElMessageBox.confirm('确定删除此模型配置吗？', '警告', { 
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning' 
    }).then(() => true).catch(() => false)

    if (!confirmed) return

    deleteModel.isLoading = true
    const res = await fetchWithTimeout(`${API_BASE}/models/${id}`, { method: 'DELETE' }, 5000)

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.message || '删除失败')
    }
    await fetchModels()
    ElMessage.success('已删除')
  } catch (e) {
    console.error('Unexpected error in deleteModel:', e)
    ElMessage.error('系统错误: ' + (e.message || '未知错误'))
  } finally {
    deleteModel.isLoading = false
  }
}

const activateModel = async (id, configKey) => {
  try {
    const value = id ? id.toString() : ''
    const payload = { [configKey]: value }
    if (configKey === 'reflection_model_id') {
      payload['reflection_enabled'] = id ? 'true' : 'false'
    }
    if (configKey === 'aux_model_id') {
      payload['aux_model_enabled'] = id ? 'true' : 'false'
    }

    await fetchWithTimeout(`${API_BASE}/configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 5000)
    
    if (configKey === 'current_model_id') currentActiveModelId.value = id
    else if (configKey === 'scorer_model_id') secretaryModelId.value = id
    else if (configKey === 'reflection_model_id') reflectionModelId.value = id
    else if (configKey === 'aux_model_id') auxModelId.value = id
    
    ElMessage.success('设置已更新')
  } catch (e) {
    ElMessage.error(e.message)
  }
}

// Logs Logic
const initSessionAndFetchLogs = async () => {
  if (isLogsFetching.value) return
  isLogsFetching.value = true
  try {
    const storedSessionId = localStorage.getItem('ppc.sessionId')
    if (storedSessionId && !selectedSessionId.value) {
      selectedSessionId.value = storedSessionId
    } else if (!selectedSessionId.value) {
      selectedSessionId.value = 'default'
    }
    await fetchLogs()
  } finally {
    isLogsFetching.value = false
  }
}

const fetchLogs = async () => {
  if (!selectedSessionId.value || isLogsFetching.value) return
  isLogsFetching.value = true
  
  // Create a unique symbol for this fetch request
  const currentRequestId = Symbol('fetchLogs')
  fetchLogs.lastRequestId = currentRequestId

  try {
    let url = `${API_BASE}/history/${selectedSource.value}/${selectedSessionId.value}?limit=50&sort=${selectedSort.value}`
    if (selectedDate.value) {
      url += `&date=${selectedDate.value}`
    }
    
    const res = await fetchWithTimeout(url, {}, 5000)
    const rawLogs = await res.json()
    
    // Only skip update if the request is stale
    if (fetchLogs.lastRequestId !== currentRequestId) {
      return
    }

    const processedLogs = rawLogs.map(log => {
        const metadata = getLogMetadata(log)
        return Object.freeze({
          ...log,
          // content is passed raw to AsyncMarkdown
          displayTime: new Date(log.timestamp).toLocaleString(),
          metadata: metadata,
          sentiment: log.sentiment || metadata.sentiment,
          importance: log.importance || metadata.importance
        })
    })
      
    logs.value = processedLogs
    
    // Auto scroll
    setTimeout(() => {
        if (currentTab.value !== 'logs') return
        const container = document.querySelector('.chat-scroll-area')
        if (container) {
            if (selectedSort.value === 'desc') {
                container.scrollTop = 0
            } else {
                container.scrollTop = container.scrollHeight
            }
        }
    }, 50)
    
  } catch (e) { 
    console.error(e) 
    ElMessage.error('获取日志失败')
  } finally {
    isLogsFetching.value = false
  }
}

const renderMessage = (content) => {
  if (!content) return ''
  let formatted = content
  
  // 仅保留少数仍在使用的功能性 XML 标签 (如核心记忆)
  const triggers = [
    { tag: 'MEMORY', title: '核心记忆', icon: '💾' }
  ]

  const replacements = []
  
  // 1. 先提取触发器，替换为占位符，避免被 marked 误解析
  triggers.forEach(({ tag, title, icon }) => {
    const regex = new RegExp(`<\\s*${tag}\\s*>([\\s\\S]*?)<\\s*/\\s*${tag}\\s*>`, 'gi')
    formatted = formatted.replace(regex, (match, jsonStr) => {
      try {
        const cleanJson = jsonStr.trim()
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
        
        const data = JSON.parse(cleanJson)
        let detailsHtml = ''
        
        if (tag.toUpperCase() === 'MEMORY') {
          const tagHtml = (data.tags || []).map(t => `<span class="pero-tag">${t}</span>`).join('')
          detailsHtml = `
            <div class="pero-memory-content">${data.content || ''}</div>
            <div class="pero-tag-cloud">${tagHtml}</div>
          `
        }

        const placeholder = `PERO_TRIG_${replacements.length}_ID`
        replacements.push({
          placeholder,
          html: `<div class="trigger-block ${tag.toLowerCase()}">
            <details>
              <summary class="trigger-header">
                <span class="trigger-icon">${icon}</span>
                <span class="trigger-title">${title}</span>
                <span class="expand-arrow">▶</span>
              </summary>
              <div class="trigger-body">${detailsHtml}</div>
            </details>
          </div>`
        })
        return placeholder
      } catch (e) {
        return match // 解析失败则保持原样
      }
    })
  })

  // 1.5 移除通用 XML 标签的块状格式化（因为 Pero 已转向 NIT 协议）
  // 不再主动将 <TAG> 内容转化为折叠面板，让其作为普通文本显示，或在后续版本中适配 NIT 渲染

  // 2. 解析 Markdown
  let html = marked.parse(formatted)

  // 3. 将占位符替换回美化后的 HTML
  replacements.forEach(r => {
    const safeHtml = r.html.replace(/\$/g, '$$$$')
    html = html.split(r.placeholder).join(safeHtml)
  })

  return dompurify.sanitize(html, { ADD_TAGS: ['details', 'summary'] })
}

const startLogEdit = (log) => {
  editingLogId.value = log.id
  editingContent.value = log.content
}

const cancelLogEdit = () => {
  editingLogId.value = null
  editingContent.value = ''
}

const saveLogEdit = async (logId) => {
  if (!editingContent.value.trim()) return
  try {
    const res = await fetchWithTimeout(`${API_BASE}/history/${logId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editingContent.value })
    }, 5000)
    if (res.ok) {
      editingLogId.value = null
      await fetchLogs()
      ElMessage.success('已修改')
    } else ElMessage.error('修改失败')
  } catch (e) { ElMessage.error('网络错误') }
}

const deleteLog = async (logId) => {
  if (!logId) {
    ElMessage.error('无效的记录ID')
    return
  }
  
  try {
    const confirmed = await ElMessageBox.confirm('确定删除这条记录？', '提示', { 
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning' 
    }).then(() => true).catch(() => false)
    
    if (!confirmed) return

    const res = await fetchWithTimeout(`${API_BASE}/history/${logId}`, { 
      method: 'DELETE' 
    }, 5000)
    
    if (res.ok) {
      ElMessage.success('已删除')
      await fetchLogs()
    } else {
      const err = await res.json()
      ElMessage.error(err.message || '删除失败')
    }
  } catch (e) {
    console.error('Error in deleteLog:', e)
    ElMessage.error('系统错误: ' + (e.message || '未知错误'))
  }
}

const retryLogAnalysis = async (log) => {
  if (!log || !log.id) return
  
  try {
    // 乐观更新 UI
    const originalStatus = log.analysis_status
    log.analysis_status = 'processing'
    
    const res = await fetchWithTimeout(`${API_BASE}/history/${log.id}/retry_analysis`, {
      method: 'POST'
    }, 5000)
    
    if (res.ok) {
      ElMessage.success('已提交重试请求')
      // 后台异步处理，稍后刷新或通过 WebSocket 更新
      // 这里简单起见，延迟刷新一下
      setTimeout(() => fetchLogs(), 2000)
    } else {
      const err = await res.json()
      ElMessage.error(err.detail || '重试请求失败')
      log.analysis_status = originalStatus // Revert
    }
  } catch (e) {
    console.error('Retry failed:', e)
    ElMessage.error('网络错误')
    log.analysis_status = 'failed'
  }
}

const deleteMemory = async (memoryId) => {
  if (!memoryId || deleteMemory.isLoading) {
    if (!memoryId) ElMessage.error('无效的记忆ID')
    return
  }

  try {
    const confirmed = await ElMessageBox.confirm('确定要遗忘这段记忆吗？', '提示', { 
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning' 
    }).then(() => true).catch(() => false)
    
    if (!confirmed) return

    deleteMemory.isLoading = true
    const res = await fetchWithTimeout(`${API_BASE}/memories/${memoryId}`, { method: 'DELETE' }, 5000)

    if (res.ok) {
      await fetchMemories()
      ElMessage.success('已遗忘')
    } else {
      const err = await res.json()
      ElMessage.error(err.message || '操作失败')
    }
  } catch (e) {
    console.error('Error in deleteMemory:', e)
    ElMessage.error('系统错误: ' + (e.message || '未知错误'))
  } finally {
    deleteMemory.isLoading = false
  }
}

const deleteTask = async (taskId) => {
  if (!taskId || deleteTask.isLoading) {
    if (!taskId) ElMessage.error('无效的任务ID')
    return
  }

  try {
    const confirmed = await ElMessageBox.confirm('确定删除此任务？', '提示', { 
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning' 
    }).then(() => true).catch(() => false)

    if (!confirmed) return

    deleteTask.isLoading = true
    const res = await fetchWithTimeout(`${API_BASE}/tasks/${taskId}`, { method: 'DELETE' }, 5000)

    if (res.ok) {
      await fetchTasks()
      ElMessage.success('已删除')
    } else {
      const err = await res.json()
      ElMessage.error(err.message || '操作失败')
    }
  } catch (e) {
    console.error('Error in deleteTask:', e)
    ElMessage.error('系统错误: ' + (e.message || '未知错误'))
  } finally {
    deleteTask.isLoading = false
  }
}

onMounted(() => {
  waitForBackend()
  // Add real-time polling for system status and pet state
  // Polling for system status using recursive setTimeout
  const pollSystemStatus = async () => {
    if (!isBackendOnline.value) {
      setTimeout(pollSystemStatus, 3000)
      return
    }
    
    // Only poll expensive status data when on Overview tab and not already polling
    if (currentTab.value === 'overview') {
      try {
        await Promise.all([
          fetchSystemStatus(),
          fetchPetState()
        ])
      } catch (e) {
        // Ignore polling errors
      }
    }
    
    // Schedule next poll only after current one finishes
    systemStatusInterval.value = setTimeout(pollSystemStatus, 3000)
  }
  
  // Start polling loop
  pollSystemStatus()

  // Listen for monitor updates
  try {
    if (window.__TAURI__) {
      listen('monitor-data-update', (event) => {
        const data = event.payload
        if (data) monitorSegments.value = data
      })
      listen('open-dashboard-monitor', () => {
        openLiveMonitor()
      })

      // Add debounced history update listener
      let logFetchTimeout = null
      listen('history-update', () => {
        if (logFetchTimeout) clearTimeout(logFetchTimeout)
        logFetchTimeout = setTimeout(() => {
          fetchLogs()
          logFetchTimeout = null
        }, 800)
      })

      // Add pet state update listener
      listen('pet-state-update', (event) => {
         petState.value = event.payload
      })
    }
  } catch (e) {
    console.error('Failed to listen to Tauri updates', e)
  }
})

onUnmounted(() => {
  if (systemStatusInterval.value) {
    clearTimeout(systemStatusInterval.value)
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler)
  }
  if (chartInstance) {
    chartInstance.dispose()
  }
})
</script>

<style scoped>
.dashboard-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  background: #fdfdfd; /* 仅在 Dashboard 页面强制实色背景 */
  overflow: hidden;
  font-family: 'Segoe UI', system-ui, sans-serif;
  z-index: 10;
}

/* 动态背景 Blob 动画 */
.background-blobs {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  opacity: 0.8; /* 增加不透明度 */
  filter: blur(120px);
  pointer-events: none;
  background: #fdfdfd; /* 确保背景不透明 */
  overflow: hidden; /* 防止 blob 溢出导致滚动条 */
}

.blob {
  position: absolute;
  border-radius: 50%;
  animation: float 10s infinite ease-in-out;
  will-change: transform;
  transform: translateZ(0);
}

.blob-1 {
  top: -10%;
  left: -10%;
  width: 600px;
  height: 600px;
  background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
}

.blob-2 {
  bottom: -10%;
  right: -10%;
  width: 500px;
  height: 500px;
  background: linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%);
  animation-delay: -2s;
}

.blob-3 {
  top: 40%;
  left: 40%;
  width: 300px;
  height: 300px;
  background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
  animation-delay: -5s;
}

.disabled-card {
  opacity: 0.65;
  filter: grayscale(0.4);
  cursor: not-allowed;
  transition: all 0.3s ease;
}

.disabled-card :deep(*) {
  pointer-events: none;
}

.disabled-card :deep(.el-switch) {
  pointer-events: auto;
}

@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -50px) scale(1.1); }
  66% { transform: translate(-20px, 20px) scale(0.9); }
}

/* 布局 */
.main-layout {
  position: relative;
  z-index: 10; /* 提升主布局层级，高于背景 */
  height: 100%;
  width: 100%;
}

/* Glass Sidebar */
.glass-sidebar {
  position: relative;
  z-index: 100; /* 确保侧边栏始终在最上层，防止被内容区的 stacking context 覆盖 */
  width: 260px !important;
  min-width: 260px;
  background: #ffffff;
  border-right: 1px solid rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  box-shadow: 4px 0 15px rgba(0, 0, 0, 0.02);
  transition: all 0.3s;
  pointer-events: auto !important; /* 强制开启点击事件 */
}

/* 按钮点击强化 */
.sidebar-menu :deep(.el-menu-item),
.quit-button,
.header-right .el-button,
.view-container .el-button,
.action-group .el-button,
.utils-group .el-button {
  pointer-events: auto !important;
  cursor: pointer !important;
}

.brand-area {
  padding: 30px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  user-select: none;
}

.logo-box {
  width: 42px;
  height: 42px;
  background: linear-gradient(135deg, #ff9a9e, #ff6b6b);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
}

.brand-text h1 {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  color: #2c3e50;
}

.version-tag {
  font-size: 10px;
  color: #909399;
  background: rgba(0,0,0,0.05);
  padding: 1px 6px;
  border-radius: 4px;
}

.sidebar-menu {
  border-right: none !important;
  flex: 1;
  background-color: #ffffff !important;
}

.sidebar-menu :deep(.el-menu-item) {
  height: 50px;
  line-height: 50px;
  margin: 4px 12px;
  border-radius: 8px;
  color: #606266;
  transition: all 0.2s;
  cursor: pointer !important;
}

.sidebar-menu :deep(.el-menu-item:hover) {
  background-color: #fff0f5 !important;
  color: #ff88aa !important;
}

.sidebar-menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(135deg, #fff0f5 0%, #ffe4ed 100%) !important;
  color: #ff88aa !important;
  font-weight: 600;
}

.sidebar-footer {
  padding: 20px;
  border-top: 1px solid rgba(0,0,0,0.05);
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.quit-button {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  font-weight: 600;
  border: 1px solid rgba(245, 108, 108, 0.2);
  background: rgba(245, 108, 108, 0.05) !important;
  color: #f56c6c !important;
  transition: all 0.3s;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.quit-button:hover {
  background: #f56c6c !important;
  color: #ffffff !important;
  box-shadow: 0 4px 12px rgba(245, 108, 108, 0.3);
  transform: translateY(-2px);
}

.status-indicator {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #909399;
}

.status-indicator.online {
  color: #67c23a;
}

.status-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

/* Glass Header */
.glass-header {
  position: relative;
  z-index: 50; /* 低于侧边栏，但高于内容区 */
  height: 64px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(12px);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 30px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.4);
}

.page-title {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* Content Area */
.content-area {
  position: relative;
  z-index: 10; /* 提高层级，确保在背景层之上 */
  padding: 24px;
  overflow-y: auto;
  scroll-behavior: smooth;
  pointer-events: auto !important; /* 确保内容区始终响应点击 */
}



.view-container {
  width: 100%;
  max-width: 1400px;
  margin: 0;
}

/* Stats Cards */
.stat-card {
  border: none;
  border-radius: 16px;
  color: white;
  transition: transform 0.3s;
  overflow: hidden;
}

.stat-card:hover {
  transform: translateY(-4px);
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  font-size: 32px;
  background: rgba(255,255,255,0.2);
  width: 60px;
  height: 60px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-info h3 {
  margin: 0;
  font-size: 14px;
  opacity: 0.9;
  font-weight: normal;
}

.stat-info .number {
  font-size: 28px;
  font-weight: bold;
}

.pink-gradient { background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%); }
.blue-gradient { background: linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%); }
.purple-gradient { background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%); }

/* Glass Cards Generic */
.glass-card {
  background: rgba(255, 255, 255, 0.8) !important;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.6) !important;
  border-radius: 16px !important;
}

/* State Box */
.state-box {
  text-align: center;
  padding: 16px;
  background: rgba(255,255,255,0.5);
  border-radius: 12px;
}
.state-box .label { font-size: 12px; color: #909399; display: block; margin-bottom: 4px; }
.state-box .value { font-size: 18px; font-weight: bold; color: #303133; margin-bottom: 8px; display: block; }

/* Logs View */
.logs-layout {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 120px);
}

.filter-card {
  margin-bottom: 16px;
}

.chat-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(0, 0, 0, 0.05);
  margin-right: -10px; /* 负边距让滚动条贴边 */
  padding-right: 20px; /* 补偿负边距，保持内容间距 */
}

.chat-bubble-wrapper {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.chat-bubble-wrapper.assistant { flex-direction: row; }
.chat-bubble-wrapper.user { flex-direction: row-reverse; }

.avatar {
  width: 40px;
  height: 40px;
  background: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  flex-shrink: 0;
}

.bubble-content-box {
  max-width: 70%;
  background: white;
  padding: 12px 16px;
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.03);
  position: relative;
}

.chat-bubble-wrapper.user .bubble-content-box {
  background: #ecf5ff;
  color: #303133;
  border-bottom-right-radius: 4px;
}

.chat-bubble-wrapper.assistant .bubble-content-box {
  background: white;
  color: #303133;
  border-bottom-left-radius: 4px;
}

.bubble-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #909399;
  margin-bottom: 6px;
}

.log-meta-tag {
  background: rgba(0,0,0,0.05);
  padding: 1px 4px;
  border-radius: 4px;
  cursor: help;
}

.log-meta-tag.importance {
  color: #e6a23c;
  background: #fdf6ec;
}

.log-meta-tag.memory {
  background: #f0f9eb;
}

.message-markdown {
  font-size: 14px;
  line-height: 1.6;
  color: #303133;
}

/* Trigger Blocks inside Markdown */
:deep(.trigger-block) {
  margin: 12px 0;
  border-radius: 12px;
  overflow: hidden;
  font-size: 13px;
  border: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  background: white;
}

:deep(.trigger-header) {
  padding: 8px 12px;
  background: rgba(0,0,0,0.03);
  font-weight: bold;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  list-style: none;
  outline: none;
}

:deep(.trigger-header::-webkit-details-marker) {
  display: none;
}

:deep(.expand-arrow) {
  margin-left: auto;
  font-size: 10px;
  color: #909399;
  transition: transform 0.2s;
}

:deep(details[open] .expand-arrow) {
  transform: rotate(90deg);
}

:deep(.trigger-title) {
  flex: 1;
}

:deep(.trigger-body) {
  padding: 12px;
  border-top: 1px solid rgba(0,0,0,0.05);
}

/* Specific Block Themes */
:deep(.trigger-block.perocue) { border-color: #ff9a9e; }
:deep(.trigger-block.perocue .trigger-header) { background: linear-gradient(90deg, #fff0f5, #ffe4e1); color: #ff6b81; }

:deep(.trigger-block.memory) { border-color: #a18cd1; }
:deep(.trigger-block.memory .trigger-header) { background: linear-gradient(90deg, #f3e5f5, #ede7f6); color: #673ab7; }

:deep(.trigger-block.click_messages) { border-color: #ffcc33; }
:deep(.trigger-block.click_messages .trigger-header) { background: linear-gradient(90deg, #fff9e6, #fff3cd); color: #b8860b; }

:deep(.trigger-block.idle_messages), :deep(.trigger-block.back_messages) { border-color: #409eff; }
:deep(.trigger-block.idle_messages .trigger-header), :deep(.trigger-block.back_messages .trigger-header) { background: linear-gradient(90deg, #ecf5ff, #d9ecff); color: #409eff; }

:deep(.trigger-block.unknown-xml) { border-color: #909399; }
:deep(.trigger-block.unknown-xml .trigger-header) { background: linear-gradient(90deg, #f4f4f5, #e9e9eb); color: #606266; }

/* Sub-elements styling */
:deep(.pero-meta-row) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}

:deep(.pero-label) {
  font-size: 11px;
  color: #909399;
  background: #f4f4f5;
  padding: 2px 6px;
  border-radius: 4px;
}

:deep(.pero-val) {
  font-weight: 600;
  color: #303133;
}

:deep(.pero-mind-box) {
  background: #fff9fb;
  border-left: 3px solid #ff9a9e;
  padding: 8px 10px;
  border-radius: 4px;
  font-style: italic;
  color: #555;
  line-height: 1.5;
}

:deep(.pero-memory-content) {
  line-height: 1.6;
  margin-bottom: 10px;
  color: #2c3e50;
}

:deep(.pero-tag-cloud) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

:deep(.pero-tag) {
  background: #f3e5f5;
  color: #7b1fa2;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

:deep(.pero-click-grid) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

:deep(.pero-part-card) {
  background: #fffdf5;
  border: 1px solid #ffecb3;
  border-radius: 8px;
  padding: 8px;
}

:deep(.part-name) {
  font-size: 11px;
  font-weight: bold;
  color: #856404;
  margin-bottom: 4px;
  border-bottom: 1px dashed #ffeeba;
  padding-bottom: 2px;
}

:deep(.part-list), :deep(.pero-topic-box), :deep(.pero-task-box) {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #444;
}

:deep(.part-list li) {
  margin-bottom: 2px;
}

:deep(.pero-task-box), :deep(.pero-topic-box) {
  padding: 8px;
  background: #f0f9eb;
  border-radius: 6px;
  color: #67c23a;
  list-style: none;
}

:deep(.trigger-block.error) {
  border-color: #f56c6c;
  color: #f56c6c;
  padding: 8px;
  background: #fef0f0;
}

.bubble-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.chat-bubble-wrapper:hover .bubble-actions {
  opacity: 1;
}

.chat-bubble-wrapper.editing .bubble-content-box {
  max-width: 100%;
  width: 100%;
}

/* Memories View */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin: 0;
  letter-spacing: 0.5px;
}

.memory-waterfall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  align-items: start;
}

.memory-item {
  /* break-inside: avoid; - removed for grid */
  margin-bottom: 0;
}

.memory-card {
  border-radius: 12px;
  transition: all 0.3s;
  cursor: default;
}

.memory-card:hover { transform: translateY(-3px); }

.memory-card.preference { border-top: 3px solid #f56c6c; }
.memory-card.event { border-top: 3px solid #409eff; }
.memory-card.fact { border-top: 3px solid #909399; }

/* Tasks Waterfall */
.task-waterfall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  align-items: start;
}

.task-item {
  /* break-inside: avoid; - removed for grid */
  margin-bottom: 0;
}

.task-card-modern {
  border-radius: 12px;
  transition: all 0.3s;
  border: none !important;
  background: rgba(255, 255, 255, 0.7) !important;
  backdrop-filter: blur(10px);
}

.task-card-modern:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08) !important;
}

.task-card-modern.reminder { border-left: 4px solid #f56c6c !important; }
.task-card-modern.topic { border-left: 4px solid #409eff !important; }

.task-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.task-content {
  font-size: 14px;
  color: #303133;
  line-height: 1.6;
  margin-bottom: 14px;
  font-weight: 500;
}

.task-bottom {
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  padding-top: 10px;
}

.task-time {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #909399;
}

.memory-top { display: flex; justify-content: space-between; margin-bottom: 8px; }
.memory-text { font-size: 14px; color: #606266; line-height: 1.5; margin-bottom: 12px; }
.memory-bottom { display: flex; justify-content: space-between; align-items: center; }
.time-hint { font-size: 11px; color: #c0c4cc; }

/* Models Grid */
.models-grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.model-config-card {
  border-radius: 12px;
  position: relative;
  overflow: hidden;
}

.model-config-card.active-main { border: 2px solid #ff88aa; }
.model-config-card.active-secretary { border: 2px solid #e6a23c; }
.model-config-card.active-reflection { border: 2px solid #f56c6c; }

/* Scrollbar Beauty */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.model-header h3 { margin: 0; font-size: 16px; }

.model-body p { margin: 4px 0; font-size: 13px; color: #606266; }

.model-actions {
  margin-top: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.utils-group { display: flex; gap: 4px; }

/* MCP Card Modern */
.mcp-card-modern {
  border-radius: 12px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.mcp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.mcp-title { font-weight: bold; font-size: 15px; }
.mcp-info { flex: 1; margin-bottom: 12px; }
.mcp-detail { font-size: 12px; color: #909399; margin-top: 4px; word-break: break-all; font-family: monospace; background: #f4f4f5; padding: 4px; border-radius: 4px; }
.mcp-footer { display: flex; justify-content: flex-end; }

/* Transition */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* List Transition */
.list-enter-active,
.list-leave-active {
  transition: all 0.4s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

/* Responsive */
@media (max-width: 768px) {
  .memory-waterfall, .task-waterfall { column-count: 1; }
  .glass-sidebar { display: none; } /* Mobile todo */
}

/* Dashboard Global Edit Input Style */
:deep(.dashboard-edit-textarea .el-textarea__inner) {
  font-size: 15px !important;
  line-height: 1.6 !important;
  padding: 12px 16px !important;
  border-radius: 12px !important;
  background-color: #ffffff !important;
  border: 2px solid #e4e7ed !important;
  color: #303133 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
  transition: all 0.3s ease !important;
  font-family: 'Segoe UI', system-ui, sans-serif !important;
}

:deep(.dashboard-edit-textarea .el-textarea__inner:focus) {
  border-color: #ff88aa !important;
  box-shadow: 0 4px 16px rgba(255, 136, 170, 0.15) !important;
  background-color: #fff !important;
}

.edit-mode {
  width: 100%;
  margin: 10px 0;
}

.edit-tools {
  margin-top: 12px;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
/* 记忆重置弹窗美化 */
:deep(.danger-reset-box) {
  animation: dangerShake 0.6s cubic-bezier(.175,.885,.32,1.275) 2 both;
  border-radius: 20px !important;
  border: 1px solid rgba(248,113,113,0.3) !important;
  box-shadow: 0 20px 50px rgba(244,63,94,0.15) !important;
  background: white !important;
}

:deep(.danger-reset-box .el-message-box__header) {
  padding-top: 24px;
}

:deep(.danger-reset-box .el-message-box__title) {
  color: #ef4444;
  font-weight: 700;
  font-size: 18px;
}

:deep(.danger-reset-box .danger-main-text) {
  font-weight: 600;
  font-size: 16px;
  color: #1e293b;
  margin-bottom: 8px;
}

:deep(.danger-reset-box .danger-sub-text) {
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
}

:deep(.danger-reset-box .el-message-box__input) {
  padding-top: 15px;
}

:deep(.danger-reset-box .el-input__wrapper) {
  border-radius: 12px;
  background: #f8fafc;
  box-shadow: none !important;
  border: 1px solid #e2e8f0;
}

:deep(.danger-reset-box .el-button--primary) {
  background: #ef4444;
  border-color: #ef4444;
  border-radius: 10px;
  padding: 10px 20px;
}

:deep(.danger-reset-box .el-button:not(.el-button--primary)) {
  border-radius: 10px;
  padding: 10px 20px;
}

@keyframes dangerShake {
  0%, 100% { transform: translate3d(0,0,0) }
  20% { transform: translate3d(-4px, 0, 0) }
  40% { transform: translate3d(4px, 0, 0) }
  60% { transform: translate3d(-3px, 0, 0) }
  80% { transform: translate3d(3px, 0, 0) }
}

/* New Memory UI Styles */
.memory-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.badges-left {
  display: flex;
  gap: 6px;
  align-items: center;
}

.actions-right {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.importance-indicator {
  color: #e6a23c;
  font-weight: bold;
  cursor: help;
}

.access-indicator {
  color: #f56c6c;
  font-weight: bold;
  cursor: help;
}

/* --- NIT Status Styles --- */
.nit-status-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.nit-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.nit-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 16px;
  color: #2c3e50;
}
.nit-metrics {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #606266;
}
.nit-plugins-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.mini-plugin-tag {
  font-family: monospace;
}
.more-tag {
  font-size: 12px;
  color: #909399;
}

/* --- Memory Dashboard Styles --- */
.memory-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.filters {
  display: flex;
  gap: 10px;
  align-items: center;
}
.tag-cloud-area {
  margin-bottom: 20px;
  background: rgba(255, 255, 255, 0.6);
  padding: 12px 16px;
  border-radius: 12px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.tag-cloud-label {
  font-size: 13px;
  font-weight: bold;
  color: #606266;
  white-space: nowrap;
  margin-top: 4px;
}
.tag-cloud-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cloud-tag {
  font-size: 12px !important;
}

/* Graph Mode */
.memory-graph-container {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  padding: 20px;
  min-height: 500px;
}
.simple-graph-view {
  position: relative;
  width: 100%;
  height: 500px;
  border: 1px solid #eee;
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
}
.graph-svg {
  width: 100%;
  height: 100%;
}
.graph-hint {
  position: absolute;
  bottom: 10px;
  left: 10px;
  font-size: 12px;
  color: #909399;
  background: rgba(255, 255, 255, 0.8);
  padding: 8px;
  border-radius: 4px;
  pointer-events: none;
}
</style>
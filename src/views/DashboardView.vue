<template>
  <div class="dashboard-wrapper">
    <CustomTitleBar :transparent="true" title="Pero Dashboard" />

    <!-- 动态背景 -->
    <div class="background-blobs">
      <div class="blob blob-1"></div>
      <div class="blob blob-2"></div>
      <div class="blob blob-3"></div>
    </div>

    <el-container class="main-layout pt-8">
      <!-- 侧边导航栏 -->
      <el-aside width="260px" class="glass-sidebar">
        <div class="brand-area">
          <div class="logo-box">
            <img :src="logoImg" class="logo-img" alt="Logo" />
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
        >
          <el-menu-item index="overview">
            <el-icon><IconMenu /></el-icon>
            <span>总览</span>
          </el-menu-item>
          <el-menu-item index="logs">
            <el-icon><ChatLineRound /></el-icon>
            <span>对话日志</span>
          </el-menu-item>
          <el-menu-item index="memories">
            <el-icon><Cpu /></el-icon>
            <span>核心记忆</span>
          </el-menu-item>
          <el-menu-item index="tasks">
            <el-icon><Bell /></el-icon>
            <span>待办任务</span>
          </el-menu-item>
          <el-menu-item index="user_settings">
            <el-icon><User /></el-icon>
            <span>用户设定</span>
          </el-menu-item>
          <el-menu-item index="model_config">
            <el-icon><SetUp /></el-icon>
            <span>模型配置</span>
          </el-menu-item>
          <el-menu-item index="voice_config">
            <el-icon><Microphone /></el-icon>
            <span>语音功能</span>
          </el-menu-item>
          <el-menu-item index="mcp_config">
            <el-icon><Connection /></el-icon>
            <span>MCP 配置</span>
          </el-menu-item>
          <el-menu-item index="napcat">
            <el-icon><ChatDotSquare /></el-icon>
            <span>NapCat 终端</span>
          </el-menu-item>
          <el-menu-item index="terminal">
            <el-icon><Monitor /></el-icon>
            <span>系统终端</span>
          </el-menu-item>
          <el-menu-item index="system_reset" style="color: #f56c6c;">
            <el-icon><Warning /></el-icon>
            <span>危险区域</span>
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
            <span>退出系统</span>
          </el-button>
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            <div class="status-indicator" :class="{ online: isBackendOnline }">
              <span class="dot"></span>
              {{ isBackendOnline ? '系统在线' : '系统离线' }}
            </div>
            <el-button 
              circle 
              size="small" 
              :icon="Refresh" 
              @click="fetchAllData" 
              :loading="isGlobalRefreshing" 
              title="刷新数据"
              style="border: none; background: transparent; color: var(--healing-text-light);"
            />
          </div>
        </div>
      </el-aside>

      <el-container>
        <!-- 主内容区 -->
        <el-main class="content-area">
          <div class="view-container-wrapper" :style="['logs', 'terminal', 'napcat'].includes(currentTab) ? 'height: 100%; overflow: hidden;' : 'min-height: 100%;'">
            <Transition name="fade-slide" mode="out-in">
              <!-- 1. 仪表盘概览 -->
                <div v-if="currentTab === 'overview'" key="overview" class="view-container">


              <el-row :gutter="20">
                <el-col :span="8">
                  <el-card shadow="hover" class="stat-card pink-gradient">
                    <div class="stat-content">
                      <div class="stat-icon">🧠</div>
                      <div class="stat-info">
                        <h3>核心记忆</h3>
                        <div class="number">{{ stats.total_memories || memories.length }}</div>
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
                        <div class="number">{{ stats.total_logs || logs.length }}</div>
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
                        <div class="number">{{ stats.total_tasks || tasks.length }}</div>
                      </div>
                    </div>
                  </el-card>
                </el-col>
              </el-row>

              <el-row :gutter="20" style="margin-top: 20px;">
                <el-col :span="24">
                  <el-card shadow="never" class="glass-card">
                    <template #header>
                      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>当前状态</span>
                        <div style="display: flex; align-items: center; gap: 10px;">
                           <span style="font-size: 12px; color: #909399;">Active Agent:</span>
                           <el-dropdown @command="switchAgent" trigger="click" :disabled="isSwitchingAgent">
                              <span class="el-dropdown-link" style="cursor: pointer; display: flex; align-items: center; gap: 5px; color: #409EFF; font-weight: bold;">
                                 {{ activeAgent?.name || 'Unknown' }}
                                 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                              </span>
                              <template #dropdown>
                                <el-dropdown-menu>
                                   <el-dropdown-item 
                                      v-for="agent in availableAgents" 
                                      :key="agent.id" 
                                      :command="agent.id"
                                      :disabled="agent.id === activeAgent?.id || !agent.is_enabled"
                                   >
                                      <div style="display: flex; align-items: center; gap: 8px;">
                                         <span>{{ agent.name }}</span>
                                         <span v-if="!agent.is_enabled" style="font-size: 10px; color: #999;">(Disabled)</span>
                                      </div>
                                   </el-dropdown-item>
                                </el-dropdown-menu>
                              </template>
                           </el-dropdown>
                        </div>
                      </div>
                    </template>
                    <el-row :gutter="20">
                      <el-col :span="8">
                        <div class="state-box">
                          <span class="label">心情</span>
                          <span class="value">{{ petState.mood || '未知' }}</span>
                          <el-progress :percentage="80" :show-text="false" color="#ff88aa" />
                        </div>
                      </el-col>
                      <el-col :span="8">
                        <div class="state-box">
                          <span class="label">氛围</span>
                          <span class="value">{{ petState.vibe || '未知' }}</span>
                          <el-progress :percentage="60" :show-text="false" color="#a0c4ff" />
                        </div>
                      </el-col>
                      <el-col :span="8">
                        <div class="state-box">
                          <span class="label">想法</span>
                          <span class="value">{{ petState.mind || '未知' }}</span>
                          <el-progress :percentage="90" :show-text="false" color="#a8e6cf" />
                        </div>
                      </el-col>
                    </el-row>
                  </el-card>
                </el-col>
              </el-row>



              <!-- NIT Status Card -->
              <!-- NIT 协议状态卡片 -->
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
                           <div style="font-weight: bold; font-size: 16px;">轻量聊天模式</div>
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
                           <div style="font-size: 13px; color: #666; margin-top: 4px;">开启后，{{ activeAgent?.name || 'Pero' }} 将通过屏幕主动感知你的存在并触发互动。采用隐私保护设计，仅提取特征。</div>
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
                             {{ activeAgent?.name || 'Pero' }} 将自动观察你的屏幕动态并进行互动。
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



            <!-- 2. 对话日志 -->
            <div v-else-if="currentTab === 'logs'" key="logs" class="view-container logs-layout">
              <el-card shadow="never" class="glass-card filter-card">
                <el-form :inline="true" size="default">
                  <el-form-item label="角色">
                    <el-dropdown @command="switchAgent" trigger="click" :disabled="isSwitchingAgent">
                      <span class="el-dropdown-link" style="cursor: pointer; display: flex; align-items: center; gap: 5px; color: #409EFF;">
                         {{ activeAgent?.name || 'Unknown' }}
                         <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                      </span>
                      <template #dropdown>
                        <el-dropdown-menu>
                           <el-dropdown-item 
                              v-for="agent in availableAgents" 
                              :key="agent.id" 
                              :command="agent.id"
                              :disabled="agent.id === activeAgent?.id || !agent.is_enabled"
                           >
                              <div style="display: flex; align-items: center; gap: 8px;">
                                 <span>{{ agent.name }}</span>
                                 <span v-if="!agent.is_enabled" style="font-size: 10px; color: #999;">(Disabled)</span>
                              </div>
                           </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </el-form-item>
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
                      <span class="role-name">{{ log.role === 'user' ? 'You' : (activeAgent?.name || 'Pero') }}</span>
                      <span class="time">{{ log.displayTime }}</span>
                      
                      <!-- 消息元数据指示器 -->
                      <span v-if="log.sentiment && log.sentiment !== 'neutral'" class="log-meta-tag" :title="`情感: ${log.sentiment}`">
                        {{ getSentimentEmoji(log.sentiment) }}
                      </span>
                      <span v-if="log.importance > 1" class="log-meta-tag importance" :title="`重要度: ${log.importance}`">
                        ⭐{{ log.importance }}
                      </span>
                      <span v-if="(log.metadata?.memory_extracted) || log.memory_id" class="log-meta-tag memory" title="此对话已提取为核心记忆">
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

                    <!-- Image Preview -->
                    <!-- 图片预览 -->
                    <div v-if="log.images && log.images.length > 0" class="log-images-preview" style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
                       <div v-for="(img, iIdx) in log.images" :key="iIdx" class="log-image-item">
                          <el-image 
                            :src="img" 
                            :preview-src-list="log.images"
                            fit="cover"
                            style="width: 120px; height: 120px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1);"
                            hide-on-click-modal
                            :initial-index="iIdx"
                          >
                            <template #error>
                              <div class="image-slot" style="display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; background: #f5f7fa; color: #909399; font-size: 20px;">
                                <el-icon><Picture /></el-icon>
                              </div>
                            </template>
                          </el-image>
                       </div>
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
                      <AsyncMarkdown :content="formatLogContent(log.content)" />
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

                      <el-button link :icon="Edit" @click="startLogEdit(log)" size="small">编辑</el-button>
                      <el-button link :icon="View" @click="openDebugDialog(log)" size="small" style="color: #909399;">调试</el-button>
                      <el-button link :icon="Delete" @click="deleteLog(log.id)" size="small" style="color: #f56c6c;">删除</el-button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. 核心记忆 (Refactored) -->
            <!-- 3. 核心记忆 (重构版) -->
            <div v-else-if="currentTab === 'memories'" key="memories" class="view-container">
              <div class="toolbar memory-toolbar">
                 <h3 class="section-title">长期记忆库</h3>
                 <div class="filters">
                    <div style="display: flex; align-items: center; margin-right: 15px;">
                        <span style="font-size: 12px; margin-right: 8px; color: #606266;">角色:</span>
                        <el-dropdown @command="switchAgent" trigger="click" :disabled="isSwitchingAgent">
                          <span class="el-dropdown-link" style="cursor: pointer; display: flex; align-items: center; gap: 5px; color: #409EFF;">
                             {{ activeAgent?.name || 'Unknown' }}
                             <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                          </span>
                          <template #dropdown>
                            <el-dropdown-menu>
                               <el-dropdown-item 
                                  v-for="agent in availableAgents" 
                                  :key="agent.id" 
                                  :command="agent.id"
                                  :disabled="agent.id === activeAgent?.id || !agent.is_enabled"
                               >
                                  <div style="display: flex; align-items: center; gap: 8px;">
                                     <span>{{ agent.name }}</span>
                                     <span v-if="!agent.is_enabled" style="font-size: 10px; color: #999;">(Disabled)</span>
                                  </div>
                               </el-dropdown-item>
                            </el-dropdown-menu>
                          </template>
                        </el-dropdown>
                    </div>
                    <el-select 
                        v-model="memoryFilterType" 
                        placeholder="类型筛选" 
                        size="small" 
                        style="width: 120px"
                        clearable
                        @change="fetchMemories"
                    >
                        <el-option label="全部类型" value="" />
                        <el-option label="🧩 记忆块 (Event)" value="event" />
                        <el-option label="🧠 事实 (Fact)" value="fact" />
                        <el-option label="🤝 誓言 (Promise)" value="promise" />
                        <el-option label="💖 偏好 (Preference)" value="preference" />
                        <el-option label="📝 工作日志 (Log)" value="work_log" />
                        <el-option label="🗄️ 归档 (Archived)" value="archived_event" />
                    </el-select>
                    <el-date-picker
                        v-model="memoryFilterDate"
                        type="date"
                        placeholder="按日期筛选"
                        value-format="YYYY-MM-DD"
                        size="small"
                        @change="fetchMemories"
                    />
                    <el-button 
                        type="danger" 
                        plain 
                        size="small" 
                        :icon="Delete" 
                        @click="clearOrphanedEdges" 
                        :loading="isClearingEdges"
                        title="清除无效的连线数据"
                        style="margin-right: 10px;"
                    >
                        清理孤立连线
                    </el-button>
                    <el-button 
                        type="primary" 
                        plain 
                        size="small" 
                        :icon="Search" 
                        @click="triggerScanLonely" 
                        :loading="isScanningLonely"
                        title="扫描并处理孤立记忆"
                        style="margin-right: 10px;"
                    >
                        孤立扫描
                    </el-button>
                    <el-button 
                        type="warning" 
                        plain 
                        size="small" 
                        :icon="Tools" 
                        @click="triggerMaintenance" 
                        :loading="isRunningMaintenance"
                        title="执行每日深度维护"
                        style="margin-right: 10px;"
                    >
                        深度维护
                    </el-button>
                    <el-button 
                        type="success" 
                        plain 
                        size="small" 
                        :icon="Connection" 
                        @click="triggerDream" 
                        :loading="isDreaming"
                        title="触发梦境联想机制"
                        style="margin-right: 10px;"
                    >
                        梦境联想
                    </el-button>
                    <el-radio-group v-model="memoryViewMode" size="small" @change="val => { if(val==='graph') fetchMemoryGraph() }">
                        <el-radio-button value="list">列表</el-radio-button>
                        <el-radio-button value="graph">图谱</el-radio-button>
                    </el-radio-group>
                 </div>
              </div>

              <!-- Tag Cloud Area -->
              <!-- 标签云区域 -->
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
              <!-- 列表模式 -->
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
              <!-- 图谱模式 -->
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
            <div v-else-if="currentTab === 'tasks'" key="tasks" class="view-container">
               <div class="toolbar" style="display: flex; justify-content: space-between; align-items: center;">
                 <h3 class="section-title">待办与计划列表</h3>
                 <div style="display: flex; align-items: center;">
                     <span style="font-size: 12px; margin-right: 8px; color: #606266;">角色:</span>
                     <el-dropdown @command="switchAgent" trigger="click" :disabled="isSwitchingAgent">
                       <span class="el-dropdown-link" style="cursor: pointer; display: flex; align-items: center; gap: 5px; color: #409EFF;">
                          {{ activeAgent?.name || 'Unknown' }}
                          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                       </span>
                       <template #dropdown>
                         <el-dropdown-menu>
                            <el-dropdown-item 
                               v-for="agent in availableAgents" 
                               :key="agent.id" 
                               :command="agent.id"
                               :disabled="agent.id === activeAgent?.id || !agent.is_enabled"
                            >
                               <div style="display: flex; align-items: center; gap: 8px;">
                                  <span>{{ agent.name }}</span>
                                  <span v-if="!agent.is_enabled" style="font-size: 10px; color: #999;">(Disabled)</span>
                               </div>
                            </el-dropdown-item>
                         </el-dropdown-menu>
                       </template>
                     </el-dropdown>
                 </div>
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
            <div v-else-if="currentTab === 'model_config'" key="model_config" class="view-container">
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
            <div v-else-if="currentTab === 'voice_config'" key="voice_config" class="view-container">
              <VoiceConfigPanel />
            </div>

            <!-- 7. MCP 配置 -->
            <div v-else-if="currentTab === 'mcp_config'" key="mcp_config" class="view-container">
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
            <div v-else-if="currentTab === 'user_settings'" key="user_settings" class="view-container">
              <el-card shadow="never" class="glass-card">
                <template #header>
                  <div class="card-header">
                    <span>主人身份设定</span>
                  </div>
                </template>
                <el-form label-position="top">
                  <el-form-item label="主人的名字 (Owner Name)">
                    <el-input v-model="userSettings.owner_name" :placeholder="(activeAgent?.name || 'Pero') + ' 对你的称呼'" />
                  </el-form-item>
                  <el-form-item label="主人的 QQ 号 (Owner QQ)">
                    <el-input v-model="userSettings.owner_qq" :placeholder="'用于 ' + (activeAgent?.name || 'Pero') + ' 主动联系你'" />
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
            <div v-else-if="currentTab === 'system_reset'" key="system_reset" class="view-container">
              <el-card shadow="never" class="glass-card danger-card">
                <template #header>
                  <div class="card-header">
                    <span style="color: #f56c6c; font-weight: bold;">⚠️ 恢复出厂设置</span>
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

            <!-- 10. NapCat Terminal -->
            <!-- 10. NapCat 终端 -->
            <div v-else-if="currentTab === 'napcat'" key="napcat" class="view-container" style="height:100%; display: flex; flex-direction: column;">
               <el-card shadow="never" class="glass-card" :body-style="{ padding: '0', display: 'flex', flexDirection: 'column', height: '100%' }" style="flex: 1; display: flex; flex-direction: column;">
                  <NapCatTerminal style="height: 100%;" />
               </el-card>
            </div>

            <!-- 11. System Terminal -->
            <!-- 11. 系统终端 -->
            <div v-else-if="currentTab === 'terminal'" key="terminal" class="view-container" style="height:100%;">
                <el-card shadow="never" class="glass-card" :body-style="{ padding: '0', height: '100%' }" style="height: 100%; display: flex; flex-direction: column;">
                   <TerminalPanel style="height: 100%;" />
                </el-card>
            </div>
            </Transition>

          </div>
        </el-main>
    </el-container>
  </el-container>

    <!-- Dialogs -->
    <!-- 弹窗 -->
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
            <el-radio value="global">全局继承</el-radio>
            <el-radio value="custom">独立配置</el-radio>
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

    <!-- Debug Log Dialog -->
    <el-dialog v-model="showDebugDialog" title="对话调试详情 (Debug View)" width="900px" custom-class="debug-dialog" destroy-on-close>
      <div v-if="currentDebugLog" class="debug-content-container">
        <div class="debug-meta-info" style="margin-bottom: 15px; padding: 10px; background: #f5f7fa; border-radius: 4px; font-size: 12px; color: #606266;">
           <p><strong>Log ID:</strong> {{ currentDebugLog.id }}</p>
           <p><strong>Role:</strong> {{ currentDebugLog.role }}</p>
           <p><strong>Raw Content Length:</strong> {{ (currentDebugLog.raw_content || currentDebugLog.content || '').length }} chars</p>
        </div>

        <div class="debug-segments-viewer">
           <div v-for="(segment, index) in debugSegments" :key="index" :class="['debug-segment', segment.type]">
              <div v-if="segment.type === 'thinking'" class="segment-label">Thinking Chain (思维链)</div>
              <div v-if="segment.type === 'nit'" class="segment-label">NIT Script (工具调用)</div>
              
              <div v-if="segment.type === 'thinking'" class="segment-content thinking-content">
                {{ segment.content }}
              </div>
              <div v-else-if="segment.type === 'nit'" class="segment-content nit-content">
                 <pre>{{ segment.content }}</pre>
              </div>
              <div v-else class="segment-content text-content">
                 <AsyncMarkdown :content="segment.content" />
              </div>
           </div>
        </div>
      </div>
    </el-dialog>

  </div>
</template>

<style scoped>
/* Debug Dialog Styles */
/* 调试对话框样式 */
.debug-segments-viewer {
  display: flex;
  flex-direction: column;
  gap: 15px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 10px;
}

.debug-segment {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px;
  position: relative;
}

.debug-segment.thinking {
  background-color: #f0f9eb;
  border-color: #e1f3d8;
}

.debug-segment.nit {
  background-color: #f4f4f5;
  border-color: #e9e9eb;
}

.debug-segment.text {
  background-color: #fff;
  border-color: #fff; /* Invisible border for text */
}

.segment-label {
  font-size: 11px;
  font-weight: bold;
  margin-bottom: 5px;
  text-transform: uppercase;
  color: #909399;
}

.thinking-content {
  color: #67c23a;
  font-style: italic;
  font-family: monospace;
  white-space: pre-wrap;
  font-size: 0.9em;
}

.nit-content pre {
  margin: 0;
  color: #909399;
  font-family: 'Consolas', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 0.85em;
}
</style>

<script setup>
import { ref, shallowRef, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import { listen, invoke } from '@/utils/ipcAdapter'
// import { listen, emit } from '@tauri-apps/api/event'
// import { getAllWebviewWindows } from '@tauri-apps/api/webviewWindow'
import VoiceConfigPanel from './VoiceConfigPanel.vue'
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
  ArrowLeft,
  View,
  ChatDotSquare,
  Monitor,
  Tools,
  Aim,
  Picture,
  ArrowDown
} from '@element-plus/icons-vue'
import TerminalPanel from '../components/TerminalPanel.vue'
import NapCatTerminal from '../components/NapCatTerminal.vue'
import logoImg from '../assets/logo1.png'
import { gatewayClient } from '../api/gateway'

// 为了防止在非 Tauri 环境下报错，定义一个 fallback 的 listen
const listenSafe = (event, callback) => {
  return listen(event, callback)
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
const isClearingEdges = ref(false)
const isScanningLonely = ref(false)
const isRunningMaintenance = ref(false)
const isDreaming = ref(false)
const showDebugDialog = ref(false)
const currentDebugLog = ref(null)
const debugSegments = ref([])

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
    // 只有当错误不是 AbortError 且未开启 silent 模式时才打印
    if (error.name !== 'AbortError' && !options.silent) {
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

// --- Agents Management ---
// --- 助手管理 ---
const availableAgents = ref([])
const activeAgent = ref(null)
const isSwitchingAgent = ref(false)

const openDebugDialog = (log) => {
  currentDebugLog.value = log
  showDebugDialog.value = true
  parseDebugContent(log.raw_content || log.content || "")
}

const parseDebugContent = (content) => {
  if (!content) {
    debugSegments.value = []
    return
  }
  
  // Regex patterns
  // 正则表达式模式
  const patterns = [
    { type: 'nit', regex: /\[\[\[NIT_CALL\]\]\][\s\S]*?\[\[\[NIT_END\]\]\]/gi },
    { type: 'nit', regex: /<(nit(?:-[0-9a-fA-F]{4})?)>[\s\S]*?<\/\1>/gi },
    { type: 'thinking', regex: /【Thinking[\s\S]*?】/gi },
    { type: 'thinking', regex: /<think>[\s\S]*?<\/think>/gi }
  ]

  let matches = []
  
  patterns.forEach(p => {
    let match
    const regex = new RegExp(p.regex) 
    while ((match = regex.exec(content)) !== null) {
      matches.push({
        type: p.type,
        start: match.index,
        end: match.index + match[0].length,
        content: match[0]
      })
    }
  })

  matches.sort((a, b) => a.start - b.start)

  const uniqueMatches = []
  if (matches.length > 0) {
    let current = matches[0]
    uniqueMatches.push(current)
    
    for (let i = 1; i < matches.length; i++) {
      const next = matches[i]
      if (next.start >= current.end) {
        uniqueMatches.push(next)
        current = next
      }
    }
  }

  const segments = []
  let lastIndex = 0

  uniqueMatches.forEach(match => {
    if (match.start > lastIndex) {
      segments.push({
        type: 'text',
        content: content.substring(lastIndex, match.start)
      })
    }
    segments.push({
      type: match.type,
      content: match.content
    })
    lastIndex = match.end
  })

  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      content: content.substring(lastIndex)
    })
  }

  debugSegments.value = segments
}

const formatLogContent = (content) => {
  if (!content) return ''
  // Hide Thinking and Monologue blocks (but keep them in raw data)
  // 隐藏 Thinking 和 Monologue 块（但在原始数据中保留它们）
  return content.replace(/【(Thinking|Monologue)[\s\S]*?】/gi, '')
}

// 编辑日志状态
const editingLogId = ref(null)
const editingContent = ref('')

// 数据源
const memories = shallowRef([])
const logs = shallowRef([])
const tasks = shallowRef([])
const stats = ref({ total_memories: 0, total_logs: 0, total_tasks: 0 })
const petState = ref({})
const userSettings = ref({
  owner_name: '主人',
  user_persona: '未设定',
  owner_qq: ''
})

// 筛选条件
const selectedSource = ref('desktop')
const selectedSessionId = ref('') 
const lastSyncedSessionId = ref(null) // Track last synced session from backend to prevent UI fighting
const selectedDate = ref('')
const selectedSort = ref('desc')

const openIdeWorkspace = async () => {
  try { await invoke('open_ide_window'); return; } catch(e) { console.error(e); ElMessage.error('无法打开 IDE 窗口'); return; }
  console.log('[Dashboard] User clicked openIdeWorkspace')
  try {
      await invoke('open_ide_window')
  } catch (e) {
    console.error('Failed to open IDE window:', e)
    const errorMsg = e instanceof Error ? e.message : JSON.stringify(e)
    ElMessage.error('无法打开 IDE 窗口: ' + errorMsg)
  }
}



// --- Polling State ---
// --- 轮询状态 ---
const pollingInterval = ref(null)

// --- Refactored Memory Dashboard State ---
// --- 重构的记忆仪表板状态 ---
const nitStatus = ref(null)
const memoryViewMode = ref('list') // 'list' or 'graph'
// 'list' (列表) 或 'graph' (图谱)
const memoryGraphData = shallowRef({ nodes: [], edges: [] })
const tagCloud = ref({})
const memoryFilterTags = ref([])
const memoryFilterDate = ref(null)
const memoryFilterType = ref('') // New type filter
// 新的类型筛选
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
        // 切换回列表模式时销毁图表以节省内存
        if (chartInstance) {
            chartInstance.dispose()
            chartInstance = null
        }
    }
})

// 监听标签页切换，动态加载数据
watch(currentTab, (newTab) => {
  if (newTab === 'logs') {
    // 每次切换到日志页都重新拉取，确保看到最新消息
    initSessionAndFetchLogs()
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
  // 离开记忆标签页时销毁图谱
  if (newTab !== 'memories' && chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})

// 监听日志筛选条件变化
watch([selectedSessionId, selectedSource, selectedSort, selectedDate], () => {
  if (currentTab.value === 'logs') {
    fetchLogs()
  }
})

// Watch active agent change to refresh data
// 监听活跃助手变化以刷新数据
watch(activeAgent, () => {
  // Clear existing data to force refresh
  // 清除现有数据以强制刷新
  memories.value = []
  logs.value = []
  tasks.value = []
  
  fetchStats() // Update overview stats
  // 更新概览统计
  
  if (currentTab.value === 'logs') fetchLogs()
  else if (currentTab.value === 'memories') fetchMemories()
  else if (currentTab.value === 'tasks') fetchTasks()
})

const topTags = computed(() => {
  if (!tagCloud.value) return []
  if (Array.isArray(tagCloud.value)) {
      return tagCloud.value
  }
  return Object.entries(tagCloud.value)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }))
})

const currentTabName = computed(() => {
  const map = {
    overview: '总览',
    logs: '对话日志',
    terminal: '系统终端',
    memories: '核心记忆',
    tasks: '待办任务',
    model_config: '模型配置',
    voice_config: '语音配置',
    mcp_config: 'MCP 连接',
    user_settings: '用户设定',
    napcat: 'NapCat 终端',
    system_reset: '危险区域'
  }
  return map[currentTab.value] || 'Dashboard'
})

const getMemoryTagType = (type) => {
  if (type === 'preference') return 'danger'
  if (type === 'event' || type === 'summary' || type === 'interaction_summary') return 'primary'
  if (type === 'archived_event') return 'info'
  if (type === 'fact') return 'success' // Green for facts // 事实为绿色
  if (type === 'promise') return 'warning' // Orange for promises // 誓言为橙色
  if (type === 'work_log') return 'warning'
  return 'info'
}

const getMemoryTypeLabel = (type) => {
  const map = {
    'event': '🧩 记忆块',
    'preference': '💖 偏好',
    'summary': '🧩 记忆块',
    'interaction_summary': '🧩 记忆块',
    'archived_event': '🗄️ 归档',
    'fact': '🧠 事实',
    'promise': '🤝 誓言',
    'work_log': '📝 工作日志'
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
  if (!log) return {}
  try {
    return JSON.parse(log.metadata_json || '{}')
  } catch (e) {
    return {}
  }
}



const fetchAgents = async () => {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/agents`, {}, 2000)
    if (res.ok) {
        const agents = await res.json()
        availableAgents.value = agents
        const active = agents.find(a => a.is_active)
        if (active) {
            activeAgent.value = active
        }
    }
  } catch (e) {
      console.error('Failed to fetch agents:', e)
  }
}

const switchAgent = async (agentId) => {
    if (isSwitchingAgent.value || agentId === activeAgent.value?.id) return
    isSwitchingAgent.value = true
    try {
        // 1. Call API to switch active agent
        const res = await fetchWithTimeout(`${API_BASE}/agents/active`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agentId })
        }, 5000)
        
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.detail || 'Failed to switch agent')
        }
        
        // 2. Refresh list to update UI
        await fetchAgents()
        ElMessage.success(`已切换到角色: ${activeAgent.value?.name}`)
        
        // 3. Persist to launch config via Electron IPC (Fire and forget)
        // 3. 通过 Electron IPC 持久化启动配置（即发即弃）
        // Get current enabled list
        // 获取当前已启用的列表
        const enabled = availableAgents.value.filter(a => a.is_enabled).map(a => a.id)
        invoke('save_agent_launch_config', { 
            enabledAgents: enabled,
            activeAgent: agentId 
        }).catch(e => console.error('Failed to save launch config:', e))

    } catch (e) {
        ElMessage.error(e.message)
    } finally {
        isSwitchingAgent.value = false
    }
}

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
      // 启动检测静默处理，避免控制台刷屏报错
      const res = await fetchWithTimeout(`${API_BASE}/pet/state`, { silent: true }, 2000)
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

// [Feature] Listen for new messages via Gateway

onMounted(() => {
    gatewayClient.on('action:new_message', (payload) => {
        // Only update if logs tab is active or we want to update stats
        if (currentTab.value === 'logs') {
            // Check if log belongs to current view filter (session/agent)
            // Ideally we check payload.session_id and payload.agent_id
            
            // For now, just prepend to logs if it's not a duplicate
            const exists = logs.value.some(l => l.id == payload.id);
            if (!exists) {
                // Construct log object compatible with UI
                const newLog = {
                    id: payload.id,
                    role: payload.role,
                    content: payload.content,
                    timestamp: payload.timestamp,
                    displayTime: new Date(payload.timestamp).toLocaleString(),
                    agent_id: payload.agent_id,
                    session_id: payload.session_id,
                    metadata: JSON.parse(payload.metadata || '{}'),
                    // Default values for other fields
                    sentiment: 'neutral',
                    importance: 1,
                    analysis_status: 'pending' 
                };
                
                // Add to list
                logs.value.unshift(newLog);
                
                // Update stats locally
                stats.value.total_logs = (stats.value.total_logs || 0) + 1;
            }
        }
    });
});

const formatBytes = (bytes, decimals = 1) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}



const fetchStats = async () => {
  try {
    let url = `${API_BASE}/stats/overview`
    if (activeAgent.value) {
      url += `?agent_id=${activeAgent.value.id}`
    }
    const res = await fetchWithTimeout(url, {}, 2000)
    const data = await res.json()
    stats.value = data
  } catch (e) {
    console.error('Failed to fetch stats:', e)
  }
}

const fetchAllData = async () => {
  if (!isBackendOnline.value || isGlobalRefreshing.value) return
  
  isGlobalRefreshing.value = true
  // 1. 先加载核心状态，确保 UI 基础信息立即可用
  try {
    await Promise.all([
      fetchPetState(),
      fetchConfig(),
      fetchStats(),
      fetchAgents()
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
        let url = `${API_BASE}/memories/graph?limit=100`
        if (activeAgent.value) {
            url += `&agent_id=${activeAgent.value.id}`
        }
        const res = await fetchWithTimeout(url, {}, 8000)
        const data = await res.json()
        
        // 确保在数据拉取后，且仍然在 memory 标签页时才初始化图表
        if (currentTab.value === 'memories') {
            memoryGraphData.value = Object.freeze(data) // 冻结数据以避免 Vue 响应式开销 // 冻结数据以避免 Vue 响应式开销
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

const clearOrphanedEdges = async () => {
    if (isClearingEdges.value) return
    try {
        await ElMessageBox.confirm(
            '确定要清理数据库中所有无效的连线吗？这不会删除任何记忆节点。',
            '清理确认',
            {
                confirmButtonText: '确定清理',
                cancelButtonText: '取消',
                type: 'warning'
            }
        )
        
        isClearingEdges.value = true
        const res = await fetchWithTimeout(`${API_BASE}/memories/orphaned_edges`, {
            method: 'DELETE'
        }, 10000)
        const data = await res.json()
        
        ElMessage.success(`清理完成，共移除 ${data.deleted_count} 条无效连线`)
        
        // Refresh graph if in graph mode
        // 如果在图谱模式下，刷新图谱
        if (memoryViewMode.value === 'graph') {
            fetchMemoryGraph()
        }
    } catch (e) {
        if (e !== 'cancel') {
            console.error(e)
            ElMessage.error('清理失败: ' + e.message)
        }
    } finally {
        isClearingEdges.value = false
    }
}

const triggerScanLonely = async () => {
    if (isScanningLonely.value) return
    isScanningLonely.value = true
    try {
        const res = await fetchWithTimeout(`${API_BASE}/memories/scan_lonely?limit=5`, {
            method: 'POST'
        })
        const data = await res.json()
        if (data.status === 'success') {
             ElMessage.success(`扫描完成: 处理了 ${data.processed_count} 条记忆，发现了 ${data.connections_found} 个新关联`)
             fetchMemories() // Refresh list
             // 刷新列表
        } else if (data.status === 'skipped') {
             ElMessage.warning(`扫描跳过: ${data.reason}`)
        } else {
             ElMessage.error('扫描失败')
        }
    } catch (e) {
        console.error(e)
        ElMessage.error('请求出错: ' + e.message)
    } finally {
        isScanningLonely.value = false
    }
}

const triggerMaintenance = async () => {
    if (isRunningMaintenance.value) return
    try {
        await ElMessageBox.confirm(
            '深度维护可能需要较长时间，且会消耗一定的 Tokens。确定要立即执行吗？',
            '执行确认',
            {
                confirmButtonText: '立即执行',
                cancelButtonText: '取消',
                type: 'info'
            }
        )

        isRunningMaintenance.value = true
        const res = await fetchWithTimeout(`${API_BASE}/memories/maintenance`, {
            method: 'POST'
        }, 120000) // Longer timeout for deep maintenance
        // 深度维护需要更长的超时时间
        const data = await res.json()
        if (data.status === 'success') {
             ElMessage.success(`维护完成: 标记重要性 ${data.important_tagged}, 记忆合并 ${data.consolidated}, 清理 ${data.cleaned_count}`)
             fetchMemories()
        } else {
             ElMessage.error(data.error || '维护失败')
        }
    } catch (e) {
        if (e !== 'cancel') {
             console.error(e)
             ElMessage.error('请求出错: ' + e.message)
        }
    } finally {
        isRunningMaintenance.value = false
    }
}

const triggerDream = async () => {
    if (isDreaming.value) return
    try {
        await ElMessageBox.confirm(
            '梦境联想将扫描近期记忆并尝试建立新的关联。确定要执行吗？',
            '执行确认',
            {
                confirmButtonText: '进入梦境',
                cancelButtonText: '取消',
                type: 'info'
            }
        )

        isDreaming.value = true
        const res = await fetchWithTimeout(`${API_BASE}/memories/dream?limit=10`, {
            method: 'POST'
        }, 60000)
        const data = await res.json()
        if (data.status === 'success') {
             ElMessage.success(`梦境完成: 扫描 ${data.anchors_processed} 个锚点，发现 ${data.new_relations} 个新关联`)
             if (memoryViewMode.value === 'graph') fetchMemoryGraph()
        } else if (data.status === 'skipped') {
             ElMessage.warning(`梦境跳过: ${data.reason}`)
        } else {
             ElMessage.error('联想失败')
        }
    } catch (e) {
        if (e !== 'cancel') {
            console.error(e)
            ElMessage.error('请求出错: ' + e.message)
        }
    } finally {
        isDreaming.value = false
    }
}

const initGraph = () => {
    if (!graphRef.value) return
    if (chartInstance) chartInstance.dispose()
    
    chartInstance = echarts.init(graphRef.value, 'dark') // Use dark theme base if available, or just manual colors // 如果可用则使用暗色主题基底，或者仅使用手动颜色
    
    const nodes = memoryGraphData.value.nodes.map(node => ({
        ...node,
        // Ensure name is string
        // 确保名称为字符串
        name: String(node.id),
        category: getMemoryTypeLabel(node.category),
        // Visual style based on sentiment/type
        // 基于情感/类型的视觉样式
        itemStyle: {
            color: getSentimentColor(node.sentiment),
            shadowBlur: 10,
            shadowColor: getSentimentColor(node.sentiment)
        }
    }))
    
    const links = memoryGraphData.value.edges
    
    // Generate categories from data
    // 从数据生成类别
    const categories = [...new Set(nodes.map(n => n.category))].map(c => ({ name: c }))

    const option = {
        backgroundColor: '#1a1a2e', // Deep space blue/black
        // 深空蓝/黑
        title: {
            text: '神经网络记忆图谱',
            subtext: '交互式知识图谱',
            top: 'bottom',
            left: 'right',
            textStyle: { color: '#fff' }
        },
        tooltip: {
            trigger: 'item',
            confine: true,
            enterable: true,
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
                    return `<div style="max-width: 240px; white-space: normal; word-break: break-word; line-height: 1.5;">
                        <div style="font-weight:bold; margin-bottom:4px; color:#a0c4ff;">🔗 关联</div>
                        <div>${params.data.relation_type}</div>
                        <div style="margin-top:4px; opacity: 0.7; font-size: 12px;">强度: ${params.data.value}</div>
                    </div>`
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
    // 调整大小处理程序
    if (resizeHandler) window.removeEventListener('resize', resizeHandler)
    resizeHandler = () => chartInstance && chartInstance.resize()
    window.addEventListener('resize', resizeHandler)
}

// Helper for colors
// 颜色助手
const getSentimentColor = (sentiment) => {
    const map = {
        'positive': '#67c23a', // green // 绿色
        'negative': '#f56c6c', // red // 红色
        'neutral': '#a0c4ff', // blue // 蓝色
        'happy': '#e6a23c', // orange/yellow // 橙色/黄色
        'sad': '#909399', // grey // 灰色
        'angry': '#f56c6c',
        'excited': '#ff88aa' // pink // 粉色
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
      isCompanionEnabled.value = !val // revert // 恢复
      ElMessage.warning(errorData.detail || '切换失败')
    }
  } catch (e) {
    isCompanionEnabled.value = !val // revert // 恢复
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
      isSocialEnabled.value = !val // revert // 恢复
      ElMessage.error('切换失败')
    }
  } catch (e) {
    isSocialEnabled.value = !val // revert // 恢复
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
      isLightweightEnabled.value = !val // revert // 恢复
      ElMessage.error('切换失败')
    }
  } catch (e) {
    isLightweightEnabled.value = !val // revert // 恢复
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
      isAuraVisionEnabled.value = !val // revert // 恢复
      ElMessage.error('切换失败')
    }
  } catch (e) {
    isAuraVisionEnabled.value = !val // revert // 恢复
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
        await invoke('quit_app')
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
    // 轮询静默失败，无需记录获取失败
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
    let url = `${API_BASE}/memories/list?limit=1000`
    if (memoryFilterDate.value) {
        url += `&date_start=${memoryFilterDate.value}`
    }
    if (memoryFilterType.value) {
        url += `&type=${memoryFilterType.value}`
    }
    if (memoryFilterTags.value.length > 0) {
        url += `&tags=${memoryFilterTags.value.join(',')}`
    }
    // Add active agent filter
    // 添加活动助手过滤器
    if (activeAgent.value) {
      url += `&agent_id=${activeAgent.value.id}`
    }
    const res = await fetchWithTimeout(url, {}, 5000)
    const rawMemories = await res.json()
    
    // Process in larger batches to reduce Vue churn
    // 分批处理以减少 Vue 抖动
    const processedMemories = []
    const batchSize = 50
    
    const processBatch = (startIndex) => {
      if (fetchMemories.lastRequestId !== currentRequestId) {
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
        setTimeout(() => processBatch(endIndex), 16) // Use 16ms to allow one frame of UI response // 使用 16ms 允许一帧 UI 响应
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
    let url = `${API_BASE}/tasks`
    // Add active agent filter
    // 添加活动助手过滤器
    if (activeAgent.value) {
      url += `?agent_id=${activeAgent.value.id}`
    }
    const res = await fetchWithTimeout(url, {}, 5000)
    const rawTasks = await res.json()
    
    // Process all at once if count is small (< 100), otherwise batch
    // 如果数量较小 (< 100)，则一次性处理，否则分批处理
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
    userSettings.value.owner_qq = data.owner_qq || ''

    // [Fix] Sync current session ID if in Work Mode
    // [修复] 如果在工作模式下，同步当前会话 ID
    // Only sync if the backend value is different from what we last synced,
    // 仅当后端值与我们要同步的值不同时才同步，
    // to avoid overwriting user's manual selection in the dropdown.
    // 以避免覆盖用户在下拉列表中手动选择的内容。
    if (data.current_session_id && data.current_session_id !== 'default') {
       if (data.current_session_id !== lastSyncedSessionId.value) {
           selectedSessionId.value = data.current_session_id
           lastSyncedSessionId.value = data.current_session_id
       }
    } else {
        // If backend is default, we can clear our tracking so if it switches to work again, we sync
        // 如果后端是默认值，我们可以清除跟踪，以便再次切换到工作模式时进行同步
        lastSyncedSessionId.value = null
    }
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
        user_persona: userSettings.value.user_persona,
        owner_qq: userSettings.value.owner_qq
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
// 系统重置逻辑
const handleSystemReset = async () => {
  if (isSaving.value) return
  try {
    const { value, action } = await ElMessageBox.prompt(
      '<div class="danger-main-text">主人，真的要让 ' + (activeAgent.value?.name || 'Pero') + ' 忘掉你吗？o(╥﹏╥)o</div>' +
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
// MCP 逻辑
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
    // 验证 JSON
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
      body: JSON.stringify({ ...mcp, enabled: mcp.enabled }) // Element Plus switch updates v-model directly // Element Plus 开关直接更新 v-model
    }, 5000)
    if (!res.ok) throw new Error('更新失败')
    await fetchMcps()
  } catch (e) {
    ElMessage.error(e.message)
    mcp.enabled = !mcp.enabled // revert
  }
}

// Model Logic
// 模型逻辑
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
// 日志逻辑
const initSessionAndFetchLogs = async () => {
  // 不在这里设置 isLogsFetching，而是交给 fetchLogs 统一管理
  // 仅负责初始化 session ID
  const storedSessionId = localStorage.getItem('ppc.sessionId')
  if (storedSessionId && !selectedSessionId.value) {
    selectedSessionId.value = storedSessionId
  } else if (!selectedSessionId.value) {
    selectedSessionId.value = 'default'
  }
  await fetchLogs()
}

const fetchLogs = async () => {
  if (!selectedSessionId.value || isLogsFetching.value) return
  isLogsFetching.value = true
  
  // Create a unique symbol for this fetch request
  // 为此获取请求创建一个唯一的符号
  const currentRequestId = Symbol('fetchLogs')
  fetchLogs.lastRequestId = currentRequestId

  try {
    let url = `${API_BASE}/history/${selectedSource.value}/${selectedSessionId.value}?limit=200&sort=${selectedSort.value}`
    if (selectedDate.value) {
      url += `&date=${selectedDate.value}`
    }
    // Add active agent filter
    // 添加活动助手过滤器
    if (activeAgent.value) {
      url += `&agent_id=${activeAgent.value.id}`
    }
    
    const res = await fetchWithTimeout(url, {}, 5000)
    const rawLogs = await res.json()
    
    // Only skip update if the request is stale
    // 仅当请求过时时跳过更新
    if (fetchLogs.lastRequestId !== currentRequestId) {
      return
    }

    // Filter out invalid logs first
    // 首先过滤掉无效日志
    const processedLogs = (Array.isArray(rawLogs) ? rawLogs : [])
      .filter(log => log && typeof log === 'object')
      .map(log => {
        const metadata = getLogMetadata(log)
        let images = []
        if (metadata && metadata.images && Array.isArray(metadata.images)) {
             images = metadata.images.map(path => `${API_BASE}/ide/image?path=${encodeURIComponent(path)}`)
        }

        return Object.freeze({
          ...log,
          // content is passed raw to AsyncMarkdown
          displayTime: new Date(log.timestamp).toLocaleString(),
          metadata: metadata || {},
          sentiment: log.sentiment || (metadata?.sentiment ?? null),
          importance: log.importance || (metadata?.importance ?? null),
          images: images
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
      emit('log-deleted', logId)
    } else {
      const err = await res.json()
      ElMessage.error(err.message || '删除失败')
    }
  } catch (e) {
    console.error('Error in deleteLog:', e)
    ElMessage.error('系统错误: ' + (e.message || '未知错误'))
  }
}

const updateLogStatus = (logId, status) => {
  const index = logs.value.findIndex(l => l.id === logId)
  if (index !== -1) {
    const newLog = { ...logs.value[index], analysis_status: status }
    // Update array immutably to support shallowRef and Object.freeze
    // 不可变地更新数组以支持 shallowRef 和 Object.freeze
    const newLogs = [...logs.value]
    newLogs[index] = Object.freeze(newLog)
    logs.value = newLogs
  }
}

const retryLogAnalysis = async (log) => {
  if (!log || !log.id) {
     ElMessage.error('无效的日志 ID')
     return
  }
  
  try {
    if (log.analysis_status === 'processing') return

    // 乐观更新 UI
    const originalStatus = log.analysis_status
    updateLogStatus(log.id, 'processing')
    
    const url = `${API_BASE}/history/${log.id}/retry_analysis`
    console.log('[Dashboard] Retrying analysis for log:', log.id, 'URL:', url)
    
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, 10000) // Increase timeout to 10s
    
    if (res.ok) {
      ElMessage.success('已提交重试请求')
      // 后台异步处理，稍后刷新或通过 WebSocket 更新
      // 这里简单起见，延迟刷新一下
      setTimeout(() => fetchLogs(), 2000)
    } else {
      const err = await res.json()
      ElMessage.error(err.detail || '重试请求失败')
      updateLogStatus(log.id, originalStatus) // Revert
    }
  } catch (e) {
    console.error('Retry failed:', e)
    // 详细输出错误信息以便排查
    const errorMsg = e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e)
    ElMessage.error(`重试失败: ${errorMsg}`)
    updateLogStatus(log.id, 'failed')
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

// Handler for state updates via Gateway
const handleStateUpdate = (payload) => {
  if (currentTab.value === 'overview') {
    fetchPetState()
  }
}

// Handler for schedule updates via Gateway
const handleScheduleUpdate = (payload) => {
  if (currentTab.value === 'tasks') {
    fetchTasks()
  }
}

// Handler for agent changes via Gateway
const handleAgentChanged = (payload) => {
  fetchAgents()
}

// Handler for log updates via Gateway
const handleLogUpdate = (payload) => {
  if (currentTab.value === 'logs') {
     // If it's a delete, we can remove locally to be snappier
     if (payload.operation === 'delete') {
         logs.value = logs.value.filter(l => l.id != payload.id)
     } else {
         // For updates or new analysis results, we fetch to get fresh data
         fetchLogs()
     }
  }
}

onMounted(() => {
  waitForBackend()
  
  // Listen for real-time updates
  gatewayClient.on('action:state_update', handleStateUpdate)
  gatewayClient.on('action:schedule_update', handleScheduleUpdate)
  gatewayClient.on('action:agent_changed', handleAgentChanged)
  gatewayClient.on('action:log_updated', handleLogUpdate)

  // Listen for monitor updates
  try {
      // Add debounced history update listener
      let logFetchTimeout = null
      listen('history-update', () => {
        if (logFetchTimeout) clearTimeout(logFetchTimeout)
        logFetchTimeout = setTimeout(() => {
          fetchLogs()
          logFetchTimeout = null
        }, 500)
      })
  } catch (e) {
      console.warn('Tauri listeners not available')
  }
})

onUnmounted(() => {
  gatewayClient.off('action:new_message')
  gatewayClient.off('action:state_update', handleStateUpdate)
  gatewayClient.off('action:schedule_update', handleScheduleUpdate)
  gatewayClient.off('action:agent_changed', handleAgentChanged)
  gatewayClient.off('action:log_updated', handleLogUpdate)
  
  if (pollingInterval.value) {
    clearTimeout(pollingInterval.value)
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
/* --- 1. Design Tokens (Healing Theme) --- */
.dashboard-wrapper {
  /* Palette */
  --healing-primary: #6CB4EE; /* Glacial Blue */
  --healing-secondary: #A2D2FF; /* Baby Blue */
  --healing-bg: rgba(240, 248, 255, 0.6);
  --healing-surface: rgba(255, 255, 255, 0.65);
  --healing-text: #475569;
  --healing-text-light: #94a3b8;
  
  /* Dimensions */
  --radius-lg: 24px;
  --radius-md: 16px;
  --radius-sm: 8px;
  
  /* Element Plus Overrides (Scoped) */
  --el-color-primary: var(--healing-primary);
  --el-color-primary-light-3: #92cbf6;
  --el-color-primary-light-5: #b9dff9;
  --el-color-primary-light-7: #dff1ff;
  --el-color-primary-light-9: #f0f9ff;
  --el-text-color-primary: var(--healing-text);
  --el-border-radius-base: var(--radius-md);
  --el-bg-color: transparent; /* Important for glass effect */
  
  /* Fonts */
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif;
  color: var(--healing-text);
  font-size: 15px;
  line-height: 1.6;
  letter-spacing: 0.01em;
  -webkit-font-smoothing: antialiased;
  
  /* Layout */
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #f0f9ff; /* Fallback */
  z-index: 10;
}

/* --- 2. Dynamic Background (Blobs) --- */
.background-blobs {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 50%, #fdfbfb 0%, #ebedee 100%); /* Subtle base */
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.6;
  animation: floatBlob 20s infinite alternate;
  will-change: transform;
}

.blob-1 {
  width: 600px;
  height: 600px;
  background: #A2D2FF;
  top: -100px;
  left: -100px;
  animation-delay: 0s;
}

.blob-2 {
  width: 500px;
  height: 500px;
  background: #ffb7b2; /* Soft pink for contrast */
  bottom: -50px;
  right: -50px;
  animation-delay: -5s;
}

.blob-3 {
  width: 400px;
  height: 400px;
  background: #e2f0cb; /* Soft green */
  bottom: 20%;
  left: 30%;
  animation-delay: -10s;
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

@keyframes floatBlob {
  0% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -50px) scale(1.1); }
  66% { transform: translate(-20px, 20px) scale(0.9); }
  100% { transform: translate(0, 0) scale(1); }
}

/* --- 3. Main Glass Layout --- */
.main-layout {
  position: relative;
  width: 95%; /* Floating card style */
  height: 92vh;
  margin: 4vh auto; /* Center vertically */
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.18);
  overflow: hidden; /* Round corners for children */
  z-index: 10;
}

/* Glass Sidebar */
.glass-sidebar {
  position: relative;
  z-index: 100;
  width: 260px !important;
  min-width: 260px;
  background: rgba(255, 255, 255, 0.3); /* Transparent for glass */
  border-right: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  flex-direction: column;
  transition: all 0.3s;
  pointer-events: auto !important;
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
  background: #ffffff;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  box-shadow: 0 4px 12px rgba(108, 180, 238, 0.3);
  overflow: hidden; /* 防止图片溢出圆角 */
}

.logo-img {
  width: 100%;
  height: 100%;
  object-fit: cover; /* 让图片填满容器 */
}

.brand-text h1 {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  background: linear-gradient(90deg, #2c3e50, var(--healing-primary));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.version-tag {
  font-size: 10px;
  color: var(--healing-text-light);
  background: rgba(255, 255, 255, 0.5);
  padding: 1px 6px;
  border-radius: 4px;
}

.sidebar-menu {
  border-right: none !important;
  flex: 1;
  background-color: transparent !important;
  padding-top: 10px;
}

.sidebar-menu :deep(.el-menu-item) {
  height: 48px;
  line-height: 48px;
  margin: 4px 16px;
  border-radius: 12px; /* Rounder */
  color: var(--healing-text);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer !important;
  border: 1px solid transparent; /* Prevent layout shift */
}

.sidebar-menu :deep(.el-menu-item:hover) {
  background-color: rgba(255, 255, 255, 0.4) !important;
  color: var(--healing-primary) !important;
  transform: translateX(4px);
}

.sidebar-menu :deep(.el-menu-item.is-active) {
  background: #ffffff !important;
  color: var(--healing-primary) !important;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(108, 180, 238, 0.15);
  transform: scale(1.02);
}

.sidebar-menu :deep(.el-icon) {
  font-size: 18px;
  margin-right: 12px;
  transition: all 0.3s;
}

.sidebar-menu :deep(.el-menu-item.is-active .el-icon) {
  color: var(--healing-primary);
  transform: scale(1.1);
}

.sidebar-footer {
  padding: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.3);
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: rgba(255, 255, 255, 0.1); /* Subtle footer separation */
}

.quit-button {
  width: 100%;
  height: 42px;
  border-radius: 12px;
  font-weight: 600;
  border: 1px solid rgba(245, 108, 108, 0.2);
  background: rgba(255, 255, 255, 0.5) !important;
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
  box-shadow: 0 6px 16px rgba(245, 108, 108, 0.25);
  transform: translateY(-2px);
  border-color: #f56c6c;
}

.status-indicator {
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--healing-text-light);
  padding: 8px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 8px;
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
  z-index: 50;
  height: 64px;
  background: transparent; /* Full transparent */
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 30px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2); /* Subtle divider */
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--healing-text);
  letter-spacing: 0.5px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* Content Area */
.content-area {
  position: relative;
  z-index: 10;
  padding: 24px;
  overflow-y: auto;
  scroll-behavior: smooth;
  pointer-events: auto !important;
}

.view-container {
  width: 100%;
  max-width: 1400px;
  margin: 0;
}

/* Stats Cards */
.stat-card {
  border: none !important;
  border-radius: var(--radius-lg);
  color: white;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  overflow: hidden;
  box-shadow: 0 10px 20px -5px rgba(0, 0, 0, 0.1);
}

.stat-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 15px 30px -5px rgba(0, 0, 0, 0.15);
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  font-size: 32px;
  background: rgba(255,255,255,0.25);
  width: 60px;
  height: 60px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.stat-info h3 {
  margin: 0;
  font-size: 14px;
  opacity: 0.95;
  font-weight: 500;
}

.stat-info .number {
  font-size: 32px; /* Bigger number */
  font-weight: 800;
  letter-spacing: -1px;
}

/* Refined Gradients */
.pink-gradient { background: linear-gradient(135deg, #ff9a9e 0%, #ffc3a0 100%); }
.blue-gradient { background: linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%); }
.purple-gradient { background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); }

/* Glass Cards Generic - The "Healing Card" */
.glass-card {
  background: rgba(255, 255, 255, 0.5) !important;
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.4) !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.05) !important;
  transition: transform 0.3s ease;
}

.glass-card:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.65) !important;
  box-shadow: 0 12px 40px 0 rgba(31, 38, 135, 0.08) !important;
}

/* Remove default card header border */
.glass-card :deep(.el-card__header) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  padding: 18px 24px;
}

.card-header span {
  font-weight: 700;
  font-size: 16px;
  color: var(--healing-text);
}

/* State Box */
.state-box {
  text-align: center;
  padding: 20px;
  background: rgba(255,255,255,0.4);
  border-radius: var(--radius-md);
  transition: all 0.3s;
}

.state-box:hover {
  background: rgba(255,255,255,0.7);
  transform: scale(1.02);
}

.state-box .label { font-size: 13px; color: var(--healing-text-light); display: block; margin-bottom: 6px; }
.state-box .value { font-size: 20px; font-weight: 800; color: var(--healing-text); margin-bottom: 12px; display: block; }

/* Logs View */
.logs-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.filter-card {
  margin-bottom: 16px;
}

.chat-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.2); /* Lighter glass */
  border: 1px solid rgba(255, 255, 255, 0.2);
  margin-right: -10px;
  padding-right: 20px;
}

.chat-bubble-wrapper {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}

.chat-bubble-wrapper.assistant { flex-direction: row; }
.chat-bubble-wrapper.user { flex-direction: row-reverse; }

.avatar {
  width: 44px;
  height: 44px;
  background: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  flex-shrink: 0;
  border: 2px solid white;
}

.bubble-content-box {
  max-width: 70%;
  padding: 16px 20px;
  border-radius: 20px; /* More rounded */
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  position: relative;
  transition: all 0.3s;
}

.chat-bubble-wrapper.user .bubble-content-box {
  background: var(--healing-primary); /* Sky Blue */
  color: white;
  border-bottom-right-radius: 4px; /* Squircle effect */
  box-shadow: 0 4px 12px rgba(108, 180, 238, 0.3);
}

.chat-bubble-wrapper.assistant .bubble-content-box {
  background: white;
  color: var(--healing-text);
  border-bottom-left-radius: 4px; /* Squircle effect */
}

/* Edit/Delete icons inside bubble */
.edit-tools .el-button {
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: inherit;
}
.edit-tools .el-button:hover {
  background: rgba(255, 255, 255, 0.4);
}

.bubble-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--healing-text-light);
  margin-bottom: 8px;
}

.log-meta-tag {
  background: rgba(0,0,0,0.05);
  padding: 2px 8px; /* Larger capsule */
  border-radius: 12px;
  cursor: help;
  font-weight: 600;
}

.log-meta-tag.importance {
  color: #e6a23c;
  background: #fdf6ec;
}

.log-meta-tag.memory {
  background: #f0f9eb;
  color: #67c23a;
}

.message-markdown {
  font-size: 15px;
  line-height: 1.6;
}

/* User text color fix for Markdown */
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body),
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body p),
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body span),
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body li),
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body strong) {
  color: white !important;
}

/* User Bubble Meta Color Fix */
.chat-bubble-wrapper.user .bubble-meta {
  color: rgba(255, 255, 255, 0.9) !important;
}
.chat-bubble-wrapper.user .bubble-meta .role-name,
.chat-bubble-wrapper.user .bubble-meta .time {
  color: inherit !important;
}

/* Exclude code blocks from being white if they have their own styling */
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body code) {
  color: #c7254e; /* Default code color or whatever fits */
  background-color: #f9f2f4;
  border-radius: 4px;
  padding: 2px 4px;
}

.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body pre) {
  background-color: #f6f8fa;
  color: #333;
}

.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body pre code) {
  color: inherit;
  background-color: transparent;
}

/* Trigger Blocks inside Markdown */
:deep(.trigger-block) {
  margin: 12px 0;
  border-radius: 16px; /* Rounded block */
  overflow: hidden;
  font-size: 13px;
  border: 1px solid rgba(0,0,0,0.05);
  box-shadow: 0 4px 12px rgba(0,0,0,0.03);
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
  font-weight: 700;
  color: var(--healing-text);
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
  margin-bottom: 0;
}

.memory-card {
  border-radius: var(--radius-md) !important;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  cursor: default;
  border: none !important;
  background: rgba(255, 255, 255, 0.6) !important;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
}

.memory-card:hover {
  transform: translateY(-4px);
  background: rgba(255, 255, 255, 0.8) !important;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08) !important;
}

.memory-card.preference { border-top: 3px solid #f56c6c !important; }
.memory-card.event { border-top: 3px solid #409eff !important; }
.memory-card.fact { border-top: 3px solid #67c23a !important; } /* Green */
.memory-card.summary { border-top: 3px solid #e6a23c !important; }

/* Tasks Waterfall */
.task-waterfall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  align-items: start;
}

.task-item {
  margin-bottom: 0;
}

.task-card-modern {
  border-radius: var(--radius-md) !important;
  transition: all 0.3s;
  border: none !important;
  background: rgba(255, 255, 255, 0.7) !important;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
}

.task-card-modern:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08) !important;
}

.task-card-modern.reminder { border-left: 4px solid #f56c6c !important; }
.task-card-modern.topic { border-left: 4px solid #409eff !important; }
.task-card-modern.todo { border-left: 4px solid #67c23a !important; }

.task-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.task-content {
  font-size: 14px;
  color: var(--healing-text);
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
  color: var(--healing-text-light);
}

  /* Global Input Styling */
  :deep(.el-input__wrapper), :deep(.el-textarea__inner) {
    box-shadow: none !important;
    background-color: rgba(255, 255, 255, 0.6) !important;
    border: 1px solid rgba(255, 255, 255, 0.5) !important;
    border-radius: var(--radius-sm) !important;
    transition: all 0.3s;
  }
  
  :deep(.el-input__wrapper:hover), :deep(.el-textarea__inner:hover) {
    background-color: rgba(255, 255, 255, 0.9) !important;
    border-color: var(--healing-secondary) !important;
  }
  
  :deep(.el-input__wrapper.is-focus), :deep(.el-textarea__inner:focus) {
    background-color: #ffffff !important;
    box-shadow: 0 0 0 2px var(--healing-secondary) !important;
  }
  
  /* Fix Dialog Transparency Issue */
  :deep(.el-dialog) {
    background: rgba(255, 255, 255, 0.95) !important;
    backdrop-filter: blur(20px);
    border-radius: var(--radius-lg);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
  }

  :deep(.el-dialog__title) {
    color: var(--healing-text);
    font-weight: 700;
  }

  :deep(.el-dialog__body) {
    color: var(--healing-text);
    padding-top: 20px;
    padding-bottom: 20px;
  }
  
  /* Ensure form labels inside dialogs are visible */
  :deep(.el-form-item__label) {
    color: var(--healing-text);
    font-weight: 500;
  }
  
  /* Ensure input text is visible */
  :deep(.el-input__inner) {
    color: #333 !important;
  }

  /* Select dropdown menu styling */
  :deep(.el-select__popper.el-popper) {
    background: rgba(255, 255, 255, 0.95) !important;
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.3);
  }
  
  :deep(.el-select-dropdown__item) {
    color: var(--healing-text);
  }
  
  :deep(.el-select-dropdown__item.hover), 
  :deep(.el-select-dropdown__item:hover) {
    background-color: var(--healing-secondary);
    color: white;
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

/* --- Transition Animations --- */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
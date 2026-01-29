<template>
  <div class="view-container">
    <div class="toolbar">
       <h3 class="section-title">语音功能配置</h3>
       <el-button type="primary" :icon="Plus" @click="openEditor(null)">添加配置</el-button>
    </div>

    <el-tabs v-model="activeTab" class="voice-tabs">
      <el-tab-pane label="语音转文本 (STT)" name="stt">
        <div class="config-grid">
           <el-card v-for="config in sttConfigs" :key="config.id" class="config-card" shadow="hover">
              <template #header>
                <div class="card-header">
                  <span class="config-name">{{ config.name }}</span>
                  <el-tag v-if="config.is_active" type="success" size="small">Current</el-tag>
                </div>
              </template>
              <div class="config-info">
                 <p><strong>Provider:</strong> {{ config.provider }}</p>
                 <p v-if="config.model"><strong>Model:</strong> {{ config.model }}</p>
              </div>
              <div class="card-actions">
                 <el-button v-if="!config.is_active" type="primary" link @click="activateConfig(config)">启用</el-button>
                 <el-button type="primary" link @click="openEditor(config)">编辑</el-button>
                 <el-button type="danger" link @click="deleteConfig(config)" :disabled="config.is_active">删除</el-button>
              </div>
           </el-card>
        </div>
      </el-tab-pane>
      <el-tab-pane label="文本转语音 (TTS)" name="tts">
        <div class="tts-header" style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; background: var(--el-fill-color-light); padding: 15px; border-radius: 8px;">
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: bold; font-size: 14px;">全局 TTS 开关</span>
                <span style="font-size: 12px; color: #909399;">关闭后 {{ AGENT_NAME }} 将不会朗读任何文本</span>
            </div>
            <el-switch v-model="ttsEnabled" @change="toggleTTSMode" active-text="开启" inactive-text="关闭" inline-prompt />
        </div>
        <div class="config-grid">
           <el-card v-for="config in ttsConfigs" :key="config.id" class="config-card" shadow="hover">
              <template #header>
                <div class="card-header">
                  <span class="config-name">{{ config.name }}</span>
                  <el-tag v-if="config.is_active" type="success" size="small">Current</el-tag>
                </div>
              </template>
              <div class="config-info">
                 <p><strong>Provider:</strong> {{ config.provider }}</p>
                 <p v-if="config.model"><strong>Model:</strong> {{ config.model }}</p>
              </div>
              <div class="card-actions">
                 <el-button v-if="!config.is_active" type="primary" link @click="activateConfig(config)">启用</el-button>
                 <el-button type="primary" link @click="openEditor(config)">编辑</el-button>
                 <el-button type="danger" link @click="deleteConfig(config)" :disabled="config.is_active">删除</el-button>
              </div>
           </el-card>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 编辑器对话框 -->
    <el-dialog v-model="showEditor" :title="editingConfig.id ? '编辑配置' : '添加配置'" width="600px">
       <el-form label-width="120px">
          <el-form-item label="类型">
             <el-radio-group v-model="editingConfig.type" :disabled="!!editingConfig.id">
                <el-radio value="stt">语音转文本 (STT)</el-radio>
                <el-radio value="tts">文本转语音 (TTS)</el-radio>
             </el-radio-group>
          </el-form-item>
          <el-form-item label="名称">
             <el-input v-model="editingConfig.name" placeholder="e.g. My Whisper" />
          </el-form-item>
          <el-form-item label="服务提供商">
             <el-select v-model="editingConfig.provider">
                <template v-if="editingConfig.type === 'stt'">
                   <el-option label="Local Whisper" value="local_whisper" />
                   <el-option label="OpenAI Compatible" value="openai_compatible" />
                </template>
                <template v-else>
                   <el-option label="Edge TTS" value="edge_tts" />
                   <el-option label="OpenAI Compatible" value="openai_compatible" />
                </template>
             </el-select>
          </el-form-item>
          
          <template v-if="editingConfig.provider === 'openai_compatible'">
             <el-form-item label="API Key">
                <el-input v-model="editingConfig.api_key" type="password" show-password />
             </el-form-item>
             <el-form-item label="Base URL">
                <el-input v-model="editingConfig.api_base" placeholder="https://api.openai.com/v1" />
             </el-form-item>
             <el-form-item label="Model">
                <div style="display: flex; gap: 10px; width: 100%;">
                   <el-input v-model="editingConfig.model" placeholder="whisper-1 / tts-1" />
                   <el-button :loading="isFetchingRemote" @click="fetchRemoteModels">获取模型</el-button>
                </div>
                <el-select 
                  v-if="remoteModels.length > 0" 
                  v-model="editingConfig.model" 
                  placeholder="从列表中选择模型" 
                  style="width: 100%; margin-top: 10px;"
                >
                   <el-option v-for="m in remoteModels" :key="m" :label="m" :value="m" />
                </el-select>
             </el-form-item>
          </template>

          <el-divider content-position="left">高级参数 (JSON)</el-divider>
          <el-form-item label="Config JSON">
             <el-input v-model="editingConfig.config_json" type="textarea" :rows="4" />
             <div class="form-tip">
                STT Local: {"device": "cpu", "compute_type": "int8"}<br>
                TTS Edge: {"voice": "zh-CN-XiaoyiNeural", "rate": "+15%", "pitch": "+5Hz"}
             </div>
          </el-form-item>
       </el-form>
       <template #footer>
          <el-button @click="showEditor = false">取消</el-button>
          <el-button type="primary" @click="saveConfig" :loading="isSaving">保存</el-button>
       </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { AGENT_NAME } from '../config'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const API_BASE = 'http://localhost:9120/api' // Adjust if needed (如果需要，请调整)
const activeTab = ref('stt')
const configs = ref([])
const showEditor = ref(false)
const isSaving = ref(false)
const editingConfig = ref({})
const remoteModels = ref([])
const isFetchingRemote = ref(false)
const ttsEnabled = ref(true)

const sttConfigs = computed(() => configs.value.filter(c => c.type === 'stt'))
const ttsConfigs = computed(() => configs.value.filter(c => c.type === 'tts'))

const fetchTTSMode = async () => {
  try {
    const res = await fetch(`${API_BASE}/config/tts`)
    if (res.ok) {
       const data = await res.json()
       ttsEnabled.value = data.enabled
    }
  } catch (e) {
    console.error(e)
  }
}

const toggleTTSMode = async (val) => {
  try {
    await fetch(`${API_BASE}/config/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: val })
    })
    ElMessage.success(val ? 'TTS 已开启' : 'TTS 已关闭')
  } catch (e) {
    ElMessage.error('设置失败')
    ttsEnabled.value = !val // revert
    // 恢复原状
  }
}

const fetchConfigs = async () => {
  try {
    const res = await fetch(`${API_BASE}/voice-configs`)
    if (res.ok) {
       configs.value = await res.json()
    }
  } catch (e) {
    console.error(e)
  }
}

const fetchRemoteModels = async () => {
  try {
    if (!editingConfig.value.api_base) {
      ElMessage.warning('请先填写 Base URL')
      return
    }
    isFetchingRemote.value = true
    const res = await fetch(`${API_BASE}/models/remote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: editingConfig.value.api_key || '',
        api_base: editingConfig.value.api_base
      })
    })
    const data = await res.json()
    if (data.models && data.models.length > 0) {
      remoteModels.value = data.models
      ElMessage.success(`成功获取 ${data.models.length} 个模型`)
    } else {
      ElMessage.warning('未能获取到模型列表，请检查配置')
    }
  } catch (e) {
    ElMessage.error('获取模型失败: ' + e.message)
  } finally {
    isFetchingRemote.value = false
  }
}

const openEditor = (config) => {
   remoteModels.value = []
   if (config) {
      editingConfig.value = JSON.parse(JSON.stringify(config))
   } else {
      editingConfig.value = {
         type: activeTab.value,
         name: '',
         provider: activeTab.value === 'stt' ? 'local_whisper' : 'edge_tts',
         config_json: '{}',
         is_active: false
      }
   }
   showEditor.value = true
}

const saveConfig = async () => {
   try {
      isSaving.value = true
      // Validate JSON
      // 验证 JSON
      try {
         JSON.parse(editingConfig.value.config_json || '{}')
      } catch {
         ElMessage.error('Config JSON 格式错误')
         return
      }

      const method = editingConfig.value.id ? 'PUT' : 'POST'
      const url = editingConfig.value.id 
         ? `${API_BASE}/voice-configs/${editingConfig.value.id}` 
         : `${API_BASE}/voice-configs`
      
      const res = await fetch(url, {
         method,
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(editingConfig.value)
      })
      
      if (!res.ok) {
         const err = await res.json()
         throw new Error(err.detail || '保存失败')
      }
      
      await fetchConfigs()
      showEditor.value = false
      ElMessage.success('保存成功')
   } catch (e) {
      ElMessage.error(e.message)
   } finally {
      isSaving.value = false
   }
}

const activateConfig = async (config) => {
   try {
      config.is_active = true
      const res = await fetch(`${API_BASE}/voice-configs/${config.id}`, {
         method: 'PUT',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(config)
      })
      if (!res.ok) throw new Error('切换失败')
      await fetchConfigs()
      ElMessage.success('已切换配置')
   } catch (e) {
      ElMessage.error(e.message)
   }
}

const deleteConfig = async (config) => {
   try {
      await ElMessageBox.confirm('确定删除此配置吗?', '警告', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' })
      const res = await fetch(`${API_BASE}/voice-configs/${config.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('删除失败')
      await fetchConfigs()
      ElMessage.success('删除成功')
   } catch (e) {
      if (e !== 'cancel') ElMessage.error(e.message)
   }
}

onMounted(() => {
   fetchConfigs()
   fetchTTSMode()
})
</script>

<style scoped>
.voice-tabs {
   margin-top: 20px;
}
.config-grid {
   display: grid;
   grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
   gap: 20px;
}
.config-card {
   border-radius: 12px;
}
.card-header {
   display: flex;
   justify-content: space-between;
   align-items: center;
}
.form-tip {
   font-size: 12px;
   color: #999;
   margin-top: 5px;
   line-height: 1.4;
}
</style>

/**
 * ECharts 按需导入 — 性能优化
 *
 * 仅导入 Graph 图表 + 必要组件，避免全量引入 ~760KB。
 * 使用 vue-echarts 的 BINDTO 模式。
 *
 * @see 按需加载
 * @module packages/frontend/src/lib/echarts
 */

import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { GraphChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent } from 'echarts/components'

// 注册所需组件（按需）
use([CanvasRenderer, GraphChart, TitleComponent, TooltipComponent, LegendComponent])

// 导出 vue-echarts 组件
export { default as VChart } from 'vue-echarts'

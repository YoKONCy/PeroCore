# Gemini 4 Argon 思考适配

更新日期：2026-10-14。本次仅修改并人工审阅源码，未运行构建、测试、静态检查或真实模型请求。

- Gemini 4 原生接口使用 `generationConfig.thinkingConfig.thinkingLevel`，支持 `low / medium / high`；不再发送旧的 `thinkingBudget`。
- 未配置等级时继续省略强度参数，保留模型默认值；`includeThoughts` 独立控制思考摘要回传。
- 兼容旧通用配置：`off → low`、`xhigh / max → high`。配置页面只显示支持的等级，并显示旧档位的实际映射。Argon 无法真正关闭思考。
- Chat Completions 兼容接口发送规范化后的 `reasoning_effort`；Google 官方端点额外发送 `extra_body.google.thinking_config.include_thoughts`，不同时发送另一份强度参数。Google 专用扩展不发送给第三方中转。
- Responses 兼容服务沿用其自身协议，同时规范化旧档位；不表示 Google 官方提供 Responses 接口。
- 输出预留与请求实际档位保持一致。等级控制的思考长度是动态的，本地思考预留属于估算，无法把上游的总输出硬上限变成独立的正文硬上限。
- Gemini 2.5 及其他模型保留现有字段行为。本次不调整 Gemini 3 各型号的档位差异。

参考：[Google 思考文档](https://ai.google.dev/gemini-api/docs/generate-content/thinking)、[Google OpenAI 兼容文档](https://ai.google.dev/gemini-api/docs/openai)。

TODO：用户授权后验证原生／兼容接口的默认、Low／Medium／High、旧档位、思考摘要及非 Gemini 请求回归。

# 能力门控 (Capability Gate)

> **最后更新**：2026-04-21

---

## 1. 核心定位

`CapabilityGate` 是 PeroCore 的单一权威权限中心。它根据 **(Agent, Mode, Context)** 矩阵，一次性决定 Agent 可用的工具、技能和提示词片段。

---

## 2. 解析逻辑

1. **查表**：读取 `agents/{id}/capabilities.py` 配置。
2. **过滤**：根据当前 `mode` (如 social/work) 提取白名单。
3. **输出**：
   - `allowedTools`：交给 Dispatcher 做运行时拦截。
   - `enabledSkills`：交给 PromptBuilder 注入菜单。
   - `promptFragments`：由 MDP 引擎按声明顺序加载。

---

## 3. 配置示例 (YAML)

```yaml
agent: pero
modes:
  desktop:
    tools: [web_search, diary_query, screen_vision]
    skills: [coding_assistant, memory_recall]
    prompt_fragments: [abilities/workspace, abilities/vision]
  social:
    tools: [web_search, send_sticker]
    skills: [social_chat]
    prompt_fragments: [social/instructions]
```

---

## 4. 优势

- **单一事实来源**：消除分散在各处的 if-else 工具过滤逻辑。
- **声明式扩展**：新增模式或角色只需增加 YAML 配置，零核心代码修改。
- **动态解锁**：支持 Skill 临时授权给 LLM 调用。

---

*本文档由 Carola 整理。*

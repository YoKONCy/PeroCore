# Security Policy / 安全策略

## Supported Versions / 支持的版本

PeroCore is currently in **Beta** development stage (v0.9.x).

PeroCore 目前处于 **Beta** 开发阶段 (v0.9.x)。

| Version / 版本 | Supported / 支持状态 | Notes / 说明 |
|:---|:---|:---|
| 0.9.x (Beta) | ⚠️ 有限支持 | Security fixes on best-effort basis.<br>安全修复以最大努力为原则。 |
| < 0.9.0 | ❌ 不支持 | Legacy codebase, no longer maintained.<br>旧代码库，不再维护。 |

## Reporting a Vulnerability / 报告漏洞

If you discover a security vulnerability or critical bug:

如果您发现了安全漏洞或严重 Bug：

### Public Issues / 公开反馈

For non-sensitive vulnerabilities, please report them directly via **GitHub Issues** with the `security` label.

对于不涉及敏感信息的漏洞，请直接在 **GitHub Issues** 中反馈，并添加 `security` 标签。

### Private Disclosure / 私密披露

If the vulnerability involves sensitive information (such as API key leaks, authentication bypasses, or data exposure), please:

如果漏洞涉及敏感信息（如 API 密钥泄漏、身份验证绕过或数据暴露），请：

1. **Do NOT** create a public issue.

   **不要**创建公开 Issue。

2. Contact the maintainer via email or GitHub private message.

   通过邮件或 GitHub 私信联系维护者。

3. Include as much detail as possible: steps to reproduce, affected components, and potential impact.

   请尽可能提供详细信息：复现步骤、受影响组件及潜在影响。

## Security Considerations / 安全注意事项

PeroCore handles the following sensitive data. Contributors should be especially careful with these areas:

PeroCore 处理以下敏感数据，贡献者应特别注意这些领域：

| Area / 领域 | Details / 详情 |
|:---|:---|
| **API Keys** | LLM provider keys (OpenAI, Anthropic, etc.) stored in local SQLite.<br>LLM 提供商密钥存储在本地 SQLite 中。 |
| **User Data** | Chat histories, memories, and agent configurations.<br>聊天记录、记忆数据和 Agent 配置。 |
| **Local File Access** | Agent tools can read/write local files via `file-ops` extension.<br>Agent 工具可通过 `file-ops` 扩展读写本地文件。 |
| **Browser Bridge** | WebSocket bridge exposes browser content to the backend.<br>WebSocket 桥接将浏览器内容暴露给后端。 |
| **Code Execution** | `run-script` and `terminal-executor` tools can execute arbitrary commands.<br>`run-script` 和 `terminal-executor` 工具可执行任意命令。 |

## Best Practices / 最佳实践

- Never commit API keys or secrets to the repository.

  永远不要将 API 密钥或机密信息提交到代码仓库。

- All sensitive configurations should be stored in `~/.perocore/` (user data directory), never in the project directory.

  所有敏感配置应存储在 `~/.perocore/`（用户数据目录），而非项目目录。

- The backend binds to `127.0.0.1` by default — do not expose it to `0.0.0.0` without authentication.

  后端默认绑定 `127.0.0.1`——在没有身份验证的情况下，请勿暴露到 `0.0.0.0`。

---

Thank you for helping keep PeroCore safe! 🛡️

感谢您帮助保障 PeroCore 的安全！🛡️

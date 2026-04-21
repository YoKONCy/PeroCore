# Changesets

这个目录用于管理版本发布和 CHANGELOG 生成。

## 日常使用

```bash
# 开发完新功能/修复后，添加变更描述
pnpm changeset

# 发布前：应用版本号更新 + 生成 CHANGELOG.md
pnpm changeset version

# 发布
pnpm changeset publish
```

## 规范

- 每个 PR 至少包含一个 changeset（除非纯文档/CI 修改）
- 遵循 SemVer 语义化版本：
  - `patch`: Bug 修复
  - `minor`: 新功能（向后兼容）
  - `major`: 不兼容的 API / 数据格式变更

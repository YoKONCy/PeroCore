---
description: render-core 私有源码 submodule 管理 (备份/发布流程)
---

## 背景

`packages/native/render-core` 是一个独立 git 仓库（submodule），包含：
- `src/` — Rust 源码（**私有**，不推送到公开仓库）
- `*.node` / `index.js` / `index.d.ts` — 编译产物（**公开**）

主仓库（PeroCore-TS）只记录 submodule 的 commit hash，不直接跟踪源码文件。

---

## 日常开发

修改 render-core 源码后，需要在 **submodule 内** 单独提交：

```powershell
cd packages/native/render-core
git add .
git commit -m "feat: ..."

# 推到私有备份 remote（首次需先 add remote）
git push origin master
```

然后更新主仓库指向最新 submodule 版本：

```powershell
cd ../../../   # 回到 PeroCore-TS 根目录
git add packages/native/render-core
git commit -m "chore: 更新 render-core submodule"
```

---

## 配置私有 Remote（首次，需要先建好私有仓库）

```powershell
cd packages/native/render-core
git remote add origin git@github.com:YOUR_ORG/pero-render-core-private.git
git push -u origin master
```

然后更新 `.gitmodules` 中的 `url` 为该地址。

---

## 发布公开编译产物

构建后，将产物推到公开仓库（只含产物，不含源码）：

```powershell
cd packages/native/render-core

# 构建
napi build --platform --release

# 创建/切换到 release 孤立分支
git checkout --orphan release-dist 2>$null || git checkout release-dist

# 只提交产物文件
git reset HEAD -- .
git add index.js index.d.ts index.ts *.node package.json
git commit -m "release: $(Get-Date -Format 'yyyy-MM-dd')"

# 推到公开 remote
git remote add public git@github.com:YOUR_ORG/pero-render-core.git 2>$null
git push public release-dist:main

# 切回开发分支
git checkout master
```

---

## Clone 时恢复 submodule

其他人（有私有仓库权限）clone 完整项目：

```bash
git clone <PeroCore-TS 仓库>
git submodule update --init --recursive
```

无私有权限的外部用户：submodule 无法拉取，但他们也不需要源码，只需 npm 包中的编译产物即可。

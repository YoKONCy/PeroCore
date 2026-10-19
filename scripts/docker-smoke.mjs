import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
const backend = read('docker/Dockerfile.backend')
const frontend = read('docker/Dockerfile.frontend')
const compose = read('docker-compose.yml')
const nginx = read('docker/nginx.conf')
const release = read('.github/workflows/release.yml')
const releaseBuilder = read('scripts/build-electron-release.cjs')
const ci = read('.github/workflows/ci.yml')
const releaseCompose = read('docker-compose.release.yml')

const legacyPatterns = [/@perocore\//, /PEROCORE_/, /perocore\.db/]
for (const [name, content] of Object.entries({ backend, frontend, compose })) {
  for (const pattern of legacyPatterns) {
    assert.equal(pattern.test(content), false, `${name} 仍包含历史配置 ${pattern}`)
  }
}

assert.match(backend, /pnpm@9\.15\.9/)
assert.match(backend, /build-daemon-bundle\.mjs/)
assert.match(backend, /collect-daemon-deps\.mjs/)
assert.match(backend, /build-official-apps\.mjs/)
assert.match(backend, /COPY --from=builder[^\n]*dist-applications\/[^\n]*\.\/applications\//)
assert.match(backend, /INFOS_RESOURCES_ROOT=\/app/)
assert.match(backend, /INFOS_APPLICATIONS_ROOT=\/app\/applications/)
assert.match(backend, /dist-daemon\/node_modules/)
assert.match(backend, /PERO_DATABASE_PATH=\/app\/data\/infos\.db/)
assert.match(backend, /PERO_APP_ROOT=\/app\/backend/)
assert.match(backend, /USER node/)
assert.match(backend, /VOLUME \["\/app\/data", "\/app\/workspaces"\]/)
assert.match(backend, /EXPOSE 9120 9121/)
assert.match(backend, /\/api\/health/)
assert.match(backend, /CMD \["node", "\/app\/backend\/daemon\.mjs"\]/)

assert.match(frontend, /@infos\/frontend/)
assert.match(frontend, /COPY scripts\/pdfAssetsPlugin\.ts/)
assert.match(frontend, /nginxinc\/nginx-unprivileged/)
assert.match(frontend, /USER nginx/)
assert.match(frontend, /EXPOSE 8080/)
assert.match(frontend, /\/healthz/)

assert.match(compose, /infos-data:\/app\/data/)
assert.match(compose, /infos-workspaces:\/app\/workspaces/)
assert.match(compose, /PERO_DATABASE_PATH: \/app\/data\/infos\.db/)
assert.match(compose, /INFOS_API_TOKEN:/)
assert.match(compose, /condition: service_healthy/)
assert.match(compose, /9120}:9120/)
assert.match(compose, /9121}:9121/)
assert.match(compose, /3000}:8080/)

assert.match(nginx, /location \/api\//)
assert.match(nginx, /proxy_buffering off/)
assert.match(nginx, /location \/ws/)
assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/)
assert.match(nginx, /location \^~ \/applications\//)
assert.match(nginx, /location \^~ \/html-previews\//)
assert.match(nginx, /client_max_body_size 32m/)
assert.match(nginx, /proxy_set_header Host \$http_host/)
assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html/)

assert.match(release, /file: docker\/Dockerfile\.backend/)
assert.match(release, /file: docker\/Dockerfile\.frontend/)
assert.match(release, /infos-backend:/)
assert.match(release, /infos-frontend:/)
assert.match(releaseCompose, /ghcr\.io\/__INFOS_OWNER__\/infos-backend:__INFOS_VERSION__/)
assert.match(release, /s\/__INFOS_OWNER__\/\$\{OWNER\}/)
for (const edition of ['standard', 'portable', 'steam']) {
  assert.ok(
    release.includes(`run: node scripts/build-electron-release.cjs ${edition}`),
    `发布未接入统一打包入口：${edition}`,
  )
  read(`electron-builder.${edition}.yml`)
}
assert.ok(releaseBuilder.includes('`electron-builder.${edition}.yml`'))
assert.match(releaseBuilder, /'--publish',\s*'never'/)
assert.match(releaseBuilder, /INFOS_EDITION: edition/)
assert.equal(
  /node-version:\s*20\b/.test(ci + release),
  false,
  'CI 与发布必须使用当前依赖支持的 Node.js 版本',
)
assert.match(ci, /run: pnpm typecheck/)
assert.match(ci, /os: \[ubuntu-latest, windows-2022\]/)
assert.match(ci, /run: docker compose build/)
assert.match(ci, /docker compose up -d --wait/)
assert.match(ci, /node scripts\/docker-runtime-smoke\.mjs/)

// COPY 的本地源必须真实存在；发行产物只检查阶段间接线。
for (const dockerfile of [backend, frontend]) {
  for (const line of dockerfile
    .split(/\r?\n/)
    .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))) {
    for (const source of line.slice(5).trim().split(/\s+/).slice(0, -1)) readFileOrDirectory(source)
  }
}
function readFileOrDirectory(relative) {
  assert.ok(existsSync(path.join(root, relative)), `Docker 构建输入不存在：${relative}`)
}

console.log('Docker 模拟冒烟通过：构建定义、运行用户、卷、健康检查、代理与发布引用均已校准。')
console.log('说明：本脚本不执行 Docker Build、Compose Up 或 Registry Push。')

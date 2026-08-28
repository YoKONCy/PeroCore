import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
const backend = read('docker/Dockerfile.backend')
const frontend = read('docker/Dockerfile.frontend')
const compose = read('docker-compose.yml')
const nginx = read('docker/nginx.conf')
const release = read('.github/workflows/release.yml')

const legacyPatterns = [/@perocore\//, /PEROCORE_/, /perocore\.db/]
for (const [name, content] of Object.entries({ backend, frontend, compose })) {
  for (const pattern of legacyPatterns) {
    assert.equal(pattern.test(content), false, `${name} 仍包含历史配置 ${pattern}`)
  }
}

assert.match(backend, /pnpm@9\.15\.9/)
assert.match(backend, /build-daemon-bundle\.mjs/)
assert.match(backend, /collect-daemon-deps\.mjs/)
assert.match(backend, /dist-daemon\/node_modules/)
assert.match(backend, /PERO_DATABASE_PATH=\/app\/data\/infos\.db/)
assert.match(backend, /PERO_APP_ROOT=\/app\/backend/)
assert.match(backend, /USER node/)
assert.match(backend, /VOLUME \["\/app\/data", "\/app\/workspaces"\]/)
assert.match(backend, /EXPOSE 9120 9121/)
assert.match(backend, /\/api\/health/)
assert.match(backend, /CMD \["node", "\/app\/backend\/daemon\.mjs"\]/)

assert.match(frontend, /@infos\/frontend/)
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
assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html/)

assert.match(release, /file: docker\/Dockerfile\.backend/)
assert.match(release, /file: docker\/Dockerfile\.frontend/)
assert.match(release, /infos-backend:/)
assert.match(release, /infos-frontend:/)

console.log('Docker 模拟冒烟通过：构建定义、运行用户、卷、健康检查、代理与发布引用均已校准。')
console.log('说明：本脚本不执行 Docker Build、Compose Up 或 Registry Push。')

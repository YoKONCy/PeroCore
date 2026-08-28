/**
 * contextRegionRuntime — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import { createHash } from 'node:crypto'
import type {
  ContextRegion,
  ContextRegionCompilation,
  ContextRegionManifestEntry,
  ContextRegionProvider,
  ContextRegionRequest,
  ContextRegionTrust,
  ContextTokenizer,
} from '@infos/shared'

import { tokenCounter } from '../tokenizer/tokenCounter'

const TRUST_ORDER: ContextRegionTrust[] = [
  'system',
  'principal',
  'authority',
  'derived',
  'external',
]

/** 与 Context Region 接口兼容的 o200k_base Tokenizer。 */
export class Utf8ContextTokenizer implements ContextTokenizer {
  readonly tokenizerId = tokenCounter.tokenizerId

  countTokens(content: string): number {
    return tokenCounter.countTokens(content)
  }
}

/** Context Region Provider生命周期、确定性收集与Copy-on-Write缓存入口。 */
export class ContextRegionRegistry {
  private readonly providers = new Map<string, ContextRegionProvider>()
  private readonly cache = new Map<string, Readonly<ContextRegion>>()

  register(provider: ContextRegionProvider): () => void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(`CONTEXT_PROVIDER_DUPLICATE: ${provider.providerId}`)
    }
    this.providers.set(provider.providerId, provider)
    return () => {
      if (this.providers.get(provider.providerId) === provider) {
        this.providers.delete(provider.providerId)
        this.invalidateProvider(provider.providerId)
      }
    }
  }

  async collect(request: ContextRegionRequest): Promise<ContextRegion[]> {
    const results = await Promise.all(
      [...this.providers.values()]
        .sort((left, right) => left.providerId.localeCompare(right.providerId))
        .map((provider) => provider.provide(request)),
    )
    return results.flat().map((region) => this.cacheRegion(region))
  }

  invalidateProvider(providerId: string): number {
    let removed = 0
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${providerId}:`)) {
        this.cache.delete(key)
        removed += 1
      }
    }
    return removed
  }

  clearCache(): void {
    this.cache.clear()
  }

  get cacheSize(): number {
    return this.cache.size
  }

  private cacheRegion(region: ContextRegion): ContextRegion {
    const normalized = normalizeRegion(region)
    const key = cacheKey(normalized)
    const existing = this.cache.get(key)
    if (existing) return cloneRegion(existing)
    const frozen = freezeRegion(normalized)
    this.cache.set(key, frozen)
    return cloneRegion(frozen)
  }
}

/** Region去重、过期检查、精确Token预算和确定性Snapshot选择器。 */
export class ContextRegionSelector {
  constructor(private readonly tokenizer: ContextTokenizer = new Utf8ContextTokenizer()) {}

  compile(
    regions: readonly ContextRegion[],
    budget: number,
    now = Date.now(),
  ): ContextRegionCompilation {
    if (regions.some((region) => region.materialize && !region.content)) {
      throw new Error('CONTEXT_ASYNC_MATERIALIZATION_REQUIRED')
    }
    return this.select(regions.map(normalizeRegion), budget, now)
  }

  async compileAsync(
    regions: readonly ContextRegion[],
    budget: number,
    now = Date.now(),
  ): Promise<ContextRegionCompilation> {
    const prepared = this.prepare(regions, now)
    const normalizedBudget = Math.max(0, Math.floor(budget))
    const materialized: ContextRegion[] = []
    let optimisticTokens = 0
    for (const region of prepared.candidates) {
      const unresolvedLazy = Boolean(region.materialize && !region.content)
      if (
        unresolvedLazy &&
        !region.required &&
        normalizedBudget > 0 &&
        optimisticTokens + region.tokenEstimate > normalizedBudget
      ) {
        prepared.manifest.push({
          ...this.manifest(region),
          selected: false,
          reason: 'budget_exceeded',
        })
        continue
      }
      const content = region.materialize ? await region.materialize() : region.content
      const measured = this.measure(normalizeRegion({ ...region, content, materialize: undefined }))
      materialized.push(measured)
      optimisticTokens += measured.tokenEstimate
    }
    return this.selectPrepared(materialized, normalizedBudget, prepared.manifest)
  }

  private select(
    regions: readonly ContextRegion[],
    budget: number,
    now: number,
  ): ContextRegionCompilation {
    const prepared = this.prepare(regions, now)
    return this.selectPrepared(
      prepared.candidates,
      Math.max(0, Math.floor(budget)),
      prepared.manifest,
    )
  }

  private prepare(regions: readonly ContextRegion[], now: number) {
    const sorted = [...regions].map(normalizeRegion).sort(compareRegions)
    const manifest: ContextRegionManifestEntry[] = []
    const candidates: ContextRegion[] = []
    const deduplicationKeys = new Set<string>()
    for (const region of sorted) {
      const base = this.manifest(region)
      if (!region.content.trim() && !region.materialize && region.delivery !== 'manifest-only') {
        manifest.push({ ...base, selected: false, reason: 'empty' })
        continue
      }
      if (region.validUntil && Date.parse(region.validUntil) <= now) {
        manifest.push({ ...base, selected: false, reason: 'expired' })
        continue
      }
      const key = region.deduplicationKey ?? region.contentHash
      if (deduplicationKeys.has(key)) {
        manifest.push({ ...base, selected: false, reason: 'duplicate' })
        continue
      }
      deduplicationKeys.add(key)
      candidates.push(region)
    }
    return { candidates, manifest }
  }

  private selectPrepared(
    candidates: readonly ContextRegion[],
    normalizedBudget: number,
    initialManifest: ContextRegionManifestEntry[],
  ): ContextRegionCompilation {
    const manifest = [...initialManifest]
    const requiredTokens = candidates
      .filter((region) => region.required)
      .reduce((sum, region) => sum + region.tokenEstimate, 0)
    if (normalizedBudget > 0 && requiredTokens > normalizedBudget) {
      throw new Error(
        `CONTEXT_REQUIRED_BUDGET_EXCEEDED: required=${requiredTokens}, budget=${normalizedBudget}`,
      )
    }

    let usedTokens = 0
    const selected: ContextRegion[] = []
    for (const region of candidates) {
      const fits = normalizedBudget === 0 || usedTokens + region.tokenEstimate <= normalizedBudget
      if (!region.required && !fits) {
        manifest.push({ ...this.manifest(region), selected: false, reason: 'budget_exceeded' })
        continue
      }
      selected.push(freezeRegion(region))
      usedTokens += region.tokenEstimate
      manifest.push({ ...this.manifest(region), selected: true, reason: 'selected' })
    }
    const stableManifest = manifest.sort((left, right) =>
      left.regionId.localeCompare(right.regionId),
    )
    return Object.freeze({
      snapshotId: snapshotId(stableManifest, this.tokenizer.tokenizerId, normalizedBudget),
      selected: Object.freeze(selected),
      manifest: Object.freeze(stableManifest.map((entry) => Object.freeze(entry))),
      usedTokens,
      budget: normalizedBudget,
    })
  }

  private measure(region: ContextRegion): ContextRegion {
    return { ...region, tokenEstimate: this.tokenizer.countTokens(region.content) }
  }

  private manifest(region: ContextRegion): Omit<ContextRegionManifestEntry, 'selected' | 'reason'> {
    return {
      providerId: region.providerId,
      regionId: region.regionId,
      kind: region.kind,
      trust: region.trust,
      priority: region.priority,
      required: region.required,
      tokenEstimate: region.tokenEstimate,
      contentHash: region.contentHash,
      sourceGeneration: region.sourceGeneration ?? sourceGeneration(region),
      sourceObjectRefs: region.sourceObjectRefs.map((ref) => ({ ...ref })),
    }
  }
}

function normalizeRegion(region: ContextRegion): ContextRegion {
  const content = region.content ?? ''
  return {
    ...region,
    content,
    contentHash: region.contentHash || createHash('sha256').update(content).digest('hex'),
    sourceGeneration: region.sourceGeneration ?? sourceGeneration(region),
    sourceObjectRefs: region.sourceObjectRefs.map((ref) => ({ ...ref })),
    provenance: structuredClone(region.provenance),
  }
}

function sourceGeneration(region: ContextRegion): string {
  return (
    region.sourceObjectRefs
      .map((ref) => `${ref.objectType}:${ref.objectId}:${ref.generation}`)
      .sort()
      .join('|') || 'none'
  )
}

function cacheKey(region: ContextRegion): string {
  return `${region.providerId}:${region.regionId}:${region.contentHash}:${region.sourceGeneration}`
}

function compareRegions(left: ContextRegion, right: ContextRegion): number {
  return (
    Number(right.required) - Number(left.required) ||
    right.priority - left.priority ||
    TRUST_ORDER.indexOf(left.trust) - TRUST_ORDER.indexOf(right.trust) ||
    left.regionId.localeCompare(right.regionId)
  )
}

function freezeRegion(region: ContextRegion): Readonly<ContextRegion> {
  return Object.freeze({
    ...region,
    sourceObjectRefs: Object.freeze(
      region.sourceObjectRefs.map((ref) => Object.freeze({ ...ref })),
    ),
    provenance: Object.freeze(structuredClone(region.provenance)),
  })
}

function cloneRegion(region: Readonly<ContextRegion>): ContextRegion {
  return {
    ...region,
    sourceObjectRefs: region.sourceObjectRefs.map((ref) => ({ ...ref })),
    provenance: structuredClone(region.provenance),
  }
}

function snapshotId(
  manifest: readonly ContextRegionManifestEntry[],
  tokenizerId: string,
  budget: number,
): string {
  const canonical = JSON.stringify({
    tokenizerId,
    budget,
    manifest: manifest.map((entry) => ({
      providerId: entry.providerId,
      regionId: entry.regionId,
      contentHash: entry.contentHash,
      sourceGeneration: entry.sourceGeneration,
      tokenEstimate: entry.tokenEstimate,
      selected: entry.selected,
      reason: entry.reason,
    })),
  })
  return createHash('sha256').update(canonical).digest('hex')
}

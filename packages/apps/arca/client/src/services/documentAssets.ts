import { onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import type { DocumentSnapshot } from '@infos/document-engine'
import { useWorkbenchStore } from '../stores/workbench'

/** 只读预览按快照读取资源；切换文稿后丢弃旧请求并释放图片地址。 */
export function useDocumentAssets(
  snapshot: Readonly<Ref<DocumentSnapshot | undefined>>,
  limit = Infinity,
) {
  const store = useWorkbenchStore()
  const assets = shallowRef<Record<string, string>>({})
  const urls = new Set<string>()
  let sequence = 0
  function clear() {
    for (const url of urls) URL.revokeObjectURL(url)
    urls.clear()
    assets.value = {}
  }
  watch(
    () => [snapshot.value, store.transport, store.connection] as const,
    async () => {
      const current = ++sequence
      clear()
      const transport = store.transport
      if (!snapshot.value || !transport || store.connection !== 'ready') return
      const nodes = snapshot.value.nodes.filter((node) => node.type === 'asset').slice(0, limit)
      for (const node of nodes) {
        if (current !== sequence) return
        const id = String(node.attributes.blobId ?? ''),
          mimeType = String(node.attributes.mimeType ?? '')
        if (
          !/^sha256:[a-f0-9]{64}$/i.test(id) ||
          assets.value[id] ||
          !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)
        )
          continue
        try {
          const result = (await transport.invoke('blob.get', { blobId: id })) as { base64: string }
          if (current !== sequence) return
          const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
          urls.add(url)
          assets.value = { ...assets.value, [id]: url }
        } catch {
          if (current !== sequence) return
          // 图片读取失败时，保留快照中的图片位置与文字信息。
        }
      }
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    sequence++
    clear()
  })
  return assets
}

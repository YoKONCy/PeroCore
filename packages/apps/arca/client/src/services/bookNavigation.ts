import { nextTick } from 'vue'
import { allowsMotion } from './surfaceMotion'

interface SharedTransition {
  finished: Promise<void>
  ready: Promise<void>
  updateCallbackDone: Promise<void>
}

/** 封面先打开，数据就绪后再进入真实文稿；失败会还原封面。 */
export async function openBook(
  book: HTMLElement | undefined,
  prepare: () => Promise<unknown>,
  navigate: () => Promise<void>,
) {
  if (!book || !allowsMotion() || document.hidden) {
    await prepare()
    await navigate()
    return
  }
  const front = book.querySelector<HTMLElement>('.book-front')
  const paper = book.querySelector<HTMLElement>('.book-paper')
  if (!front || !paper) {
    await prepare()
    await navigate()
    return
  }
  // 时长统一从毫秒制样式参数读取，原生过渡与备用浮层保持同一节奏。
  const motion = getComputedStyle(document.documentElement)
  const duration = (name: string, fallback: number) =>
    Number.parseFloat(motion.getPropertyValue(name)) || fallback
  const easing = motion.getPropertyValue('--arca-book-ease').trim() || 'cubic-bezier(.42,0,.22,1)'
  let opening: Animation | undefined, flight: Animation | undefined
  let overlay: HTMLElement | undefined,
    destination: HTMLElement | null = null
  let oldMaxHeight = '',
    oldOverflow = ''
  const oldName = paper.style.getPropertyValue('view-transition-name')
  try {
    book.classList.add('book-is-opening')
    opening = front.animate(
      [{ transform: getComputedStyle(front).transform }, { transform: 'rotateY(-166deg)' }],
      { duration: duration('--arca-book-open-duration', 820), easing, fill: 'forwards' },
    )
    await Promise.all([prepare(), opening.finished.catch(() => {})])
    if (!book.isConnected) return
    if (document.hidden || !allowsMotion()) {
      await navigate()
      return
    }
    const startTransition = (
      document as unknown as {
        startViewTransition?: (update: () => Promise<void>) => SharedTransition
      }
    ).startViewTransition
    if (startTransition) {
      paper.style.setProperty('view-transition-name', 'arca-document')
      document.documentElement.classList.add('arca-book-transition')
      let navigationError: unknown
      let transition: SharedTransition
      try {
        transition = startTransition.call(document, async () => {
          await navigate()
          await nextTick()
          destination = document.querySelector<HTMLElement>('.office-paper')
          destination?.style.setProperty('view-transition-name', 'arca-document')
          // 过渡只捕获首屏纸面，长文内容在动画结束后恢复正常滚动。
          if (destination) {
            oldMaxHeight = destination.style.maxHeight
            oldOverflow = destination.style.overflow
            destination.style.maxHeight = '960px'
            destination.style.overflow = 'hidden'
          }
        })
      } catch {
        await navigate()
        return
      }
      void transition.ready.catch(() => {})
      const updated = transition.updateCallbackDone.catch((error) => {
        navigationError = error
      })
      await transition.finished.catch(() => {})
      await updated
      if (navigationError) throw navigationError
    } else {
      const bounds = paper.getBoundingClientRect()
      overlay = document.createElement('div')
      overlay.className = 'book-flight'
      overlay.inert = true
      overlay.setAttribute('aria-hidden', 'true')
      Object.assign(overlay.style, {
        left: bounds.left + 'px',
        top: bounds.top + 'px',
        width: bounds.width + 'px',
        height: bounds.height + 'px',
      })
      const copy = paper.cloneNode(true) as HTMLElement
      for (const element of copy.querySelectorAll('[id]')) element.removeAttribute('id')
      overlay.append(copy)
      document.body.append(overlay)
      // 克隆图片先完成解码，再卸载预览并释放其资源地址。
      await Promise.all(
        [...copy.querySelectorAll('img')].map((image) => image.decode().catch(() => {})),
      )
      if (!book.isConnected) return
      document.documentElement.classList.add('arca-book-flight')
      await navigate()
      await nextTick()
      destination = document.querySelector<HTMLElement>('.office-paper')
      if (!destination) return
      const target = destination.getBoundingClientRect()
      const targetHeight = Math.min(target.height, 960)
      flight = overlay.animate(
        [
          {
            left: bounds.left + 'px',
            top: bounds.top + 'px',
            width: bounds.width + 'px',
            height: bounds.height + 'px',
            opacity: 1,
          },
          {
            left: target.left + 'px',
            top: target.top + 'px',
            width: target.width + 'px',
            height: targetHeight + 'px',
            opacity: 1,
            offset: 0.7,
          },
          {
            left: target.left + 'px',
            top: target.top + 'px',
            width: target.width + 'px',
            height: targetHeight + 'px',
            opacity: 0,
          },
        ],
        { duration: duration('--arca-book-travel-duration', 650), easing, fill: 'forwards' },
      )
      await flight.finished.catch(() => {})
    }
  } catch (error) {
    if (book.isConnected && allowsMotion()) {
      const current = getComputedStyle(front).transform
      opening?.cancel()
      const closing = front.animate([{ transform: current }, { transform: 'rotateY(0)' }], {
        duration: duration('--arca-book-close-duration', 320),
        easing,
      })
      await closing.finished.catch(() => {})
      closing.cancel()
    }
    throw error
  } finally {
    opening?.cancel()
    flight?.cancel()
    overlay?.remove()
    book.classList.remove('book-is-opening')
    if (oldName) paper.style.setProperty('view-transition-name', oldName)
    else paper.style.removeProperty('view-transition-name')
    destination?.style.removeProperty('view-transition-name')
    if (destination && document.documentElement.classList.contains('arca-book-transition')) {
      destination.style.maxHeight = oldMaxHeight
      destination.style.overflow = oldOverflow
    }
    document.documentElement.classList.remove('arca-book-transition', 'arca-book-flight')
  }
}

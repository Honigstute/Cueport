import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reactHarness = vi.hoisted(() => {
  let refCursor = 0
  let refs: Array<{ current: unknown }> = []
  let effectCleanups: Array<() => void> = []
  let stateUpdates: unknown[] = []

  return {
    beginRender(): void {
      refCursor = 0
    },
    cleanup(): void {
      for (const cleanup of effectCleanups.splice(0).reverse()) cleanup()
    },
    reset(): void {
      refCursor = 0
      refs = []
      effectCleanups = []
      stateUpdates = []
    },
    stateUpdates(): unknown[] {
      return stateUpdates
    },
    useEffect(effect: () => void | (() => void)): void {
      const cleanup = effect()
      if (cleanup) effectCleanups.push(cleanup)
    },
    useRef<T>(initialValue: T): { current: T } {
      const index = refCursor++
      if (!refs[index]) refs[index] = { current: initialValue }
      return refs[index] as { current: T }
    },
    useState<T>(initialValue: T): [T, (value: T) => void] {
      return [initialValue, (value: T) => stateUpdates.push(value)]
    }
  }
})

vi.mock('react', () => ({
  useCallback: <T>(callback: T): T => callback,
  useEffect: reactHarness.useEffect,
  useRef: reactHarness.useRef,
  useState: reactHarness.useState
}))

import { useClickDragScroll } from './useClickDragScroll'

type WindowListener = (event: Record<string, unknown>) => void

class FakeWindow {
  private readonly listeners = new Map<string, Set<WindowListener>>()
  private readonly animationFrames = new Map<number, (time: number) => void>()
  private nextAnimationFrameId = 1

  addEventListener(type: string, listener: WindowListener): void {
    const listeners = this.listeners.get(type) ?? new Set<WindowListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  clearTimeout(timer: number): void {
    globalThis.clearTimeout(timer)
  }

  cancelAnimationFrame(frame: number): void {
    this.animationFrames.delete(frame)
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }

  requestAnimationFrame(callback: (time: number) => void): number {
    const id = this.nextAnimationFrameId++
    this.animationFrames.set(id, callback)
    return id
  }

  runAnimationFrame(time: number): void {
    const callbacks = [...this.animationFrames.values()]
    this.animationFrames.clear()
    for (const callback of callbacks) callback(time)
  }

  removeEventListener(type: string, listener: WindowListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  setTimeout(handler: () => void, timeout: number): number {
    return globalThis.setTimeout(handler, timeout) as unknown as number
  }
}

class FakeElement {
  constructor(private readonly interactive = false) {}

  closest(): FakeElement | null {
    return this.interactive ? this : null
  }
}

class FakeStyle {
  private readonly values = new Map<string, string>()

  getPropertyValue(property: string): string {
    return this.values.get(property) ?? ''
  }

  removeProperty(property: string): string {
    const previous = this.getPropertyValue(property)
    this.values.delete(property)
    return previous
  }

  setProperty(property: string, value: string): void {
    this.values.set(property, value)
  }
}

class FakeScroller extends FakeElement {
  clientHeight = 600
  clientWidth = 800
  scrollHeight = 1800
  scrollLeft = 80
  scrollTop = 240
  scrollWidth = 1600
  dataset: Record<string, string> = {}
  style = new FakeStyle()

  private capturedPointerId: number | null = null

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointerId === pointerId
  }

  releasePointerCapture(pointerId: number): void {
    if (this.capturedPointerId === pointerId) this.capturedPointerId = null
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointerId = pointerId
  }
}

interface PointerOptions {
  altKey?: boolean
  button?: number
  clientX?: number
  clientY?: number
  ctrlKey?: boolean
  isPrimary?: boolean
  metaKey?: boolean
  pointerId?: number
  pointerType?: string
  shiftKey?: boolean
  target?: FakeElement
  timeStamp?: number
}

function pointerDownEvent(scroller: FakeScroller, options: PointerOptions = {}): Record<string, unknown> {
  return {
    altKey: false,
    button: 0,
    clientX: 100,
    clientY: 120,
    ctrlKey: false,
    currentTarget: scroller,
    isPrimary: true,
    metaKey: false,
    pointerId: 7,
    pointerType: 'mouse',
    shiftKey: false,
    target: scroller,
    timeStamp: 1,
    ...options
  }
}

function pointerMoveEvent(options: Partial<{ buttons: number; clientX: number; clientY: number; pointerId: number; timeStamp: number }> = {}): Record<string, unknown> & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    buttons: 1,
    clientX: 100,
    clientY: 120,
    pointerId: 7,
    preventDefault: vi.fn(),
    timeStamp: 17,
    ...options
  }
}

function clickEvent(detail = 1): Record<string, unknown> & {
  preventDefault: ReturnType<typeof vi.fn>
  stopPropagation: ReturnType<typeof vi.fn>
} {
  return {
    detail,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  }
}

function renderHook(
  resetKey = 'slide-a',
  navigation?: Parameters<typeof useClickDragScroll>[1]
): ReturnType<typeof useClickDragScroll> {
  reactHarness.beginRender()
  return useClickDragScroll(resetKey, navigation)
}

let fakeWindow: FakeWindow

beforeEach(() => {
  vi.useFakeTimers()
  reactHarness.reset()
  fakeWindow = new FakeWindow()
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('window', fakeWindow)
})

afterEach(() => {
  reactHarness.cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useClickDragScroll', () => {
  it('keeps small pointer movement as a normal click', () => {
    const scroller = new FakeScroller()
    const hook = renderHook()

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    const move = pointerMoveEvent({ clientX: 104, clientY: 122 })
    fakeWindow.dispatch('pointermove', move)
    fakeWindow.dispatch('pointerup', { pointerId: 7 })

    expect(move.preventDefault).not.toHaveBeenCalled()
    expect(scroller.scrollLeft).toBe(80)
    expect(scroller.scrollTop).toBe(240)

    const click = clickEvent()
    hook.onClickCapture(click as never)
    expect(click.preventDefault).not.toHaveBeenCalled()
    expect(click.stopPropagation).not.toHaveBeenCalled()
  })

  it('pans overflowing artwork after the five-pixel threshold', () => {
    const scroller = new FakeScroller()
    const hook = renderHook()

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    const move = pointerMoveEvent({ clientX: 70, clientY: 160 })
    fakeWindow.dispatch('pointermove', move)

    expect(move.preventDefault).toHaveBeenCalledOnce()
    expect(scroller.scrollLeft).toBe(110)
    expect(scroller.scrollTop).toBe(200)
    expect(reactHarness.stateUpdates()).toContain(true)
  })

  it('continues scrolling with momentum after a quick drag release', () => {
    const scroller = new FakeScroller()
    const hook = renderHook()

    hook.onPointerDown(pointerDownEvent(scroller, { timeStamp: 1 }) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientY: 70, timeStamp: 17 }))
    fakeWindow.dispatch('pointerup', { pointerId: 7 })
    const releasedAt = scroller.scrollTop

    fakeWindow.runAnimationFrame(33)
    const firstGlidePosition = scroller.scrollTop
    expect(firstGlidePosition).toBeGreaterThan(releasedAt)

    fakeWindow.runAnimationFrame(50)
    expect(scroller.scrollTop).toBeGreaterThan(firstGlidePosition)
  })

  it('interrupts vertical momentum as soon as the user scrolls again', () => {
    const scroller = new FakeScroller()
    const hook = renderHook()

    hook.onPointerDown(pointerDownEvent(scroller, { timeStamp: 1 }) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientY: 70, timeStamp: 17 }))
    fakeWindow.dispatch('pointerup', { pointerId: 7 })
    fakeWindow.runAnimationFrame(33)
    const interruptedAt = scroller.scrollTop

    hook.onWheel({} as never)
    fakeWindow.runAnimationFrame(50)
    expect(scroller.scrollTop).toBe(interruptedAt)
  })

  it('commits immediately at the lower direction-locked navigation threshold', () => {
    const scroller = new FakeScroller()
    scroller.scrollHeight = scroller.clientHeight
    scroller.scrollWidth = scroller.clientWidth
    scroller.scrollLeft = 0
    const onNavigate = vi.fn()
    const hook = renderHook('slide-a', {
      canNavigateNext: true,
      canNavigatePrevious: true,
      onNavigate
    })

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientX: 170 }))
    expect(scroller.style.getPropertyValue('--slide-drag-offset')).toBe('14px')
    expect(scroller.dataset.swipeActive).toBe('true')
    expect(reactHarness.stateUpdates()).toContainEqual({ armed: false, direction: -1 })
    fakeWindow.dispatch('pointerup', { pointerId: 7 })
    expect(onNavigate).not.toHaveBeenCalled()
    expect(scroller.style.getPropertyValue('--slide-drag-offset')).toBe('')
    expect(scroller.dataset.swipeActive).toBeUndefined()

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientX: 173 }))
    expect(reactHarness.stateUpdates()).toContainEqual({ armed: true, direction: -1 })
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith(-1)
    expect(scroller.style.getPropertyValue('--slide-drag-offset')).toBe('')
    expect(scroller.dataset.swipeActive).toBeUndefined()

    fakeWindow.dispatch('pointerup', { pointerId: 7 })
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('pans wide artwork before counting movement beyond its edge as navigation', () => {
    const scroller = new FakeScroller()
    const onNavigate = vi.fn()
    const hook = renderHook('slide-a', {
      canNavigateNext: true,
      canNavigatePrevious: true,
      onNavigate
    })

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientX: -200 }))
    fakeWindow.dispatch('pointerup', { pointerId: 7 })
    expect(scroller.scrollLeft).toBe(380)
    expect(onNavigate).not.toHaveBeenCalled()

    scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth
    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientX: -45 }))
    expect(onNavigate).toHaveBeenCalledWith(1)
    fakeWindow.dispatch('pointerup', { pointerId: 7 })
    expect(onNavigate).toHaveBeenCalledOnce()
  })

  it('settles a cancelled slide pull without horizontal momentum', () => {
    const scroller = new FakeScroller()
    scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth
    const onNavigate = vi.fn()
    const hook = renderHook('slide-a', {
      canNavigateNext: true,
      canNavigatePrevious: true,
      onNavigate
    })

    hook.onPointerDown(pointerDownEvent(scroller, { timeStamp: 1 }) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientX: 40, timeStamp: 17 }))
    expect(scroller.style.getPropertyValue('--slide-drag-offset')).toBe('-12px')

    fakeWindow.dispatch('pointerup', { pointerId: 7, timeStamp: 20 })
    const releasedAt = scroller.scrollLeft
    fakeWindow.runAnimationFrame(36)

    expect(onNavigate).not.toHaveBeenCalled()
    expect(scroller.scrollLeft).toBe(releasedAt)
    expect(scroller.style.getPropertyValue('--slide-drag-offset')).toBe('')
  })

  it('does not navigate when a large gesture is primarily vertical', () => {
    const scroller = new FakeScroller()
    scroller.scrollLeft = 0
    const onNavigate = vi.fn()
    const hook = renderHook('slide-a', {
      canNavigateNext: true,
      canNavigatePrevious: true,
      onNavigate
    })

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientX: 270, clientY: 380 }))
    fakeWindow.dispatch('pointerup', { pointerId: 7 })

    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('suppresses exactly the synthesized mouse click after a committed drag', () => {
    const scroller = new FakeScroller()
    const hook = renderHook()

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientY: 80 }))
    fakeWindow.dispatch('pointerup', { pointerId: 7 })

    const keyboardClick = clickEvent(0)
    hook.onClickCapture(keyboardClick as never)
    expect(keyboardClick.preventDefault).not.toHaveBeenCalled()

    const synthesizedClick = clickEvent()
    hook.onClickCapture(synthesizedClick as never)
    expect(synthesizedClick.preventDefault).toHaveBeenCalledOnce()
    expect(synthesizedClick.stopPropagation).toHaveBeenCalledOnce()

    const nextClick = clickEvent()
    hook.onClickCapture(nextClick as never)
    expect(nextClick.preventDefault).not.toHaveBeenCalled()
  })

  it('keeps the synthesized click suppressed when a swipe immediately replaces the slide', () => {
    const scroller = new FakeScroller()
    scroller.scrollHeight = scroller.clientHeight
    scroller.scrollWidth = scroller.clientWidth
    scroller.scrollLeft = 0
    const onNavigate = vi.fn()
    const navigation = {
      canNavigateNext: true,
      canNavigatePrevious: true,
      onNavigate
    }
    const hook = renderHook('slide-a', navigation)

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientX: 245 }))
    fakeWindow.dispatch('pointerup', { pointerId: 7 })
    expect(onNavigate).toHaveBeenCalledWith(-1)

    const nextSlideHook = renderHook('slide-b', navigation)
    const synthesizedClick = clickEvent()
    nextSlideHook.onClickCapture(synthesizedClick as never)

    expect(synthesizedClick.preventDefault).toHaveBeenCalledOnce()
    expect(synthesizedClick.stopPropagation).toHaveBeenCalledOnce()
  })

  it('expires click suppression when the pointer sequence produces no click', () => {
    const scroller = new FakeScroller()
    const hook = renderHook()

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientX: 140 }))
    fakeWindow.dispatch('pointerup', { pointerId: 7 })
    vi.runOnlyPendingTimers()

    const laterClick = clickEvent()
    hook.onClickCapture(laterClick as never)
    expect(laterClick.preventDefault).not.toHaveBeenCalled()
  })

  it('removes global tracking listeners after pointer end and unmount', () => {
    const scroller = new FakeScroller()
    const hook = renderHook()

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    expect(fakeWindow.listenerCount('pointermove')).toBe(1)
    expect(fakeWindow.listenerCount('pointerup')).toBe(1)
    expect(fakeWindow.listenerCount('pointercancel')).toBe(1)
    expect(fakeWindow.listenerCount('blur')).toBe(1)

    fakeWindow.dispatch('pointercancel', { pointerId: 7 })
    expect(fakeWindow.listenerCount('pointermove')).toBe(0)
    expect(fakeWindow.listenerCount('pointerup')).toBe(0)
    expect(fakeWindow.listenerCount('pointercancel')).toBe(0)
    expect(fakeWindow.listenerCount('blur')).toBe(0)

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    reactHarness.cleanup()
    expect(fakeWindow.listenerCount('pointermove')).toBe(0)
    expect(fakeWindow.listenerCount('pointerup')).toBe(0)
    expect(fakeWindow.listenerCount('pointercancel')).toBe(0)
    expect(fakeWindow.listenerCount('blur')).toBe(0)
  })

  it('cancels an in-flight drag when the active artwork changes', () => {
    const scroller = new FakeScroller()
    const hook = renderHook('slide-a')

    hook.onPointerDown(pointerDownEvent(scroller) as never)
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientY: 80 }))
    expect(fakeWindow.listenerCount('pointermove')).toBe(1)

    renderHook('slide-b')
    expect(fakeWindow.listenerCount('pointermove')).toBe(0)

    const scrollTop = scroller.scrollTop
    fakeWindow.dispatch('pointermove', pointerMoveEvent({ clientY: 40 }))
    expect(scroller.scrollTop).toBe(scrollTop)
  })

  it('does not take over touch, modified, interactive, or non-scrollable pointers', () => {
    const hook = renderHook()
    const scroller = new FakeScroller()

    hook.onPointerDown(pointerDownEvent(scroller, { pointerType: 'touch' }) as never)
    hook.onPointerDown(pointerDownEvent(scroller, { shiftKey: true }) as never)
    hook.onPointerDown(pointerDownEvent(scroller, { target: new FakeElement(true) }) as never)
    scroller.scrollHeight = scroller.clientHeight
    scroller.scrollWidth = scroller.clientWidth
    hook.onPointerDown(pointerDownEvent(scroller) as never)

    expect(fakeWindow.listenerCount('pointermove')).toBe(0)
  })
})

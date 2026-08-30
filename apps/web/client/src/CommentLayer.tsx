import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { commentAnchorFromClientPoint, moveCommentAnchor, type NormalizedCommentAnchor } from '../../../../src/renderer/src/lib/commentAnchors'
import { api } from './api'
import { CommentBody } from './commentLinks'
import type { DiscussionComment, DiscussionThread } from './commentTypes'
import { ConfirmationDialog } from './ConfirmationDialog'
import { ProfileAvatar } from './ProfileAvatar'

interface PanelAnchor {
  element?: HTMLElement
  point: { x: number; y: number }
}

export interface CommentLayerHandle {
  openComposerAt: (clientX: number, clientY: number) => boolean
}

interface CommentLayerProps {
  enabled: boolean
  shareToken: string
  slideId: string
}

const PIN_DRAG_THRESHOLD = 4

function formatCommentTime(timestamp: string): string {
  const value = new Date(timestamp)
  if (Number.isNaN(value.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function usePanelPosition(anchor: PanelAnchor, panelRef: React.RefObject<HTMLElement | null>): React.CSSProperties {
  const [style, setStyle] = useState<React.CSSProperties>({ left: anchor.point.x, top: anchor.point.y })
  useLayoutEffect(() => {
    let frame = 0
    const update = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const panel = panelRef.current
        if (!panel) return
        const rect = anchor.element?.getBoundingClientRect()
        const x = rect ? rect.left + rect.width / 2 : anchor.point.x
        const y = rect ? rect.top + rect.height / 2 : anchor.point.y
        const width = panel.offsetWidth || 360
        const height = panel.offsetHeight || 480
        const roomRight = window.innerWidth - x
        const left = roomRight >= width + 24 ? x + 14 : x - width - 14
        setStyle({
          left: Math.max(8, Math.min(window.innerWidth - width - 8, left)),
          top: Math.max(8, Math.min(window.innerHeight - height - 8, y - 56))
        })
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = new ResizeObserver(update)
    if (anchor.element) observer.observe(anchor.element)
    if (panelRef.current) observer.observe(panelRef.current)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer.disconnect()
    }
  }, [anchor, panelRef])
  return style
}

function DiscussionPanel({
  anchor,
  busy,
  draft,
  error,
  onClose,
  onCreate,
  onDeleteComment,
  onDeleteThread,
  onEditComment,
  onReply,
  thread
}: {
  anchor: PanelAnchor
  busy: boolean
  draft: NormalizedCommentAnchor | null
  error: string | null
  onClose: () => void
  onCreate: (body: string, requestId: string) => Promise<void>
  onDeleteComment: (comment: DiscussionComment) => Promise<void>
  onDeleteThread: () => Promise<void>
  onEditComment: (comment: DiscussionComment, body: string) => Promise<void>
  onReply: (body: string, requestId: string) => Promise<void>
  thread: DiscussionThread | null
}): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null)
  const [body, setBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const submissionIdRef = useRef(crypto.randomUUID())
  const style = usePanelPosition(anchor, panelRef)

  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (deleteConfirmationOpen) return
      if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (deleteConfirmationOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [deleteConfirmationOpen, onClose])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!body.trim()) return
    try {
      if (draft) await onCreate(body, submissionIdRef.current)
      else await onReply(body, submissionIdRef.current)
      submissionIdRef.current = crypto.randomUUID()
      setBody('')
    } catch {
      // The parent exposes the server message and the draft remains intact.
    }
  }

  const panel = createPortal(
    <aside aria-label={draft ? 'New discussion' : 'Discussion'} className="discussion-panel" data-no-pan ref={panelRef} style={style}>
      <header className="discussion-header">
        <div><strong>{draft ? 'New discussion' : 'Discussion'}</strong>{thread && <span>{thread.comments.length}</span>}</div>
        <div>
          {thread?.canDelete && <button aria-label="Delete discussion" className="icon-button discussion-delete-thread" onClick={() => setDeleteConfirmationOpen(true)} title="Delete discussion" type="button"><Icon name="remove" size={15} /></button>}
          <button aria-label="Close discussion" className="icon-button" onClick={onClose} type="button"><Icon name="close" size={15} /></button>
        </div>
      </header>
      {thread && (
        <div className="discussion-messages">
          {thread.comments.map((comment) => (
            <article className="discussion-message" key={comment.id}>
              <ProfileAvatar profile={comment.author} size={32} />
              <div className="discussion-message-content">
                <header><div><strong>{comment.author.displayName}</strong>{comment.author.title && <span>{comment.author.title}</span>}</div><time dateTime={comment.createdAt}>{formatCommentTime(comment.createdAt)}{comment.edited ? ' · Edited' : ''}</time></header>
                {editingId === comment.id ? (
                  <form className="discussion-edit" onSubmit={(event) => { event.preventDefault(); void onEditComment(comment, editBody).then(() => setEditingId(null)).catch(() => undefined) }}>
                    <textarea autoFocus maxLength={4000} onChange={(event) => setEditBody(event.target.value)} value={editBody} />
                    <div><button onClick={() => setEditingId(null)} type="button">Cancel</button><button className="web-primary" disabled={busy || !editBody.trim()} type="submit">Save</button></div>
                  </form>
                ) : <CommentBody body={comment.body} />}
                {editingId !== comment.id && (comment.canEdit || comment.canDelete) && (
                  <div className="discussion-message-actions">
                    {comment.canEdit && <button onClick={() => { setEditingId(comment.id); setEditBody(comment.body) }} type="button">Edit</button>}
                    {comment.canDelete && <button className="danger" onClick={() => void onDeleteComment(comment).catch(() => undefined)} type="button">Delete</button>}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {error && <p className="discussion-error" role="alert">{error}</p>}
      <form className="discussion-composer" onSubmit={(event) => void submit(event)}>
        <textarea autoFocus={Boolean(draft)} maxLength={4000} onChange={(event) => setBody(event.target.value)} placeholder={draft ? 'Start a discussion…' : 'Write a reply…'} value={body} />
        <button aria-label={draft ? 'Create discussion' : 'Send reply'} className="discussion-send" disabled={busy || !body.trim()} type="submit"><Icon name="send" size={16} /></button>
      </form>
    </aside>,
    document.body
  )

  return (
    <>
      {panel}
      {deleteConfirmationOpen && (
        <ConfirmationDialog
          confirmLabel="Delete discussion"
          description="The complete discussion and every comment inside it will be permanently deleted."
          errorMessage="The discussion could not be deleted."
          eyebrow="Delete discussion"
          onClose={() => setDeleteConfirmationOpen(false)}
          onConfirm={onDeleteThread}
          title="Delete this discussion?"
        />
      )}
    </>
  )
}

export const CommentLayer = forwardRef<CommentLayerHandle, CommentLayerProps>(function CommentLayer(
  { enabled, shareToken, slideId },
  forwardedRef
): React.JSX.Element {
  const [threads, setThreads] = useState<DiscussionThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [draft, setDraft] = useState<NormalizedCommentAnchor | null>(null)
  const [panelAnchor, setPanelAnchor] = useState<PanelAnchor | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftPinElement, setDraftPinElement] = useState<HTMLSpanElement | null>(null)
  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const pinElementsRef = useRef(new Map<string, HTMLButtonElement>())
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const draggingThreadIdRef = useRef<string | null>(null)
  const suppressedClickThreadRef = useRef<string | null>(null)
  const suppressClickTimerRef = useRef<number | null>(null)
  const activeThread = useMemo(() => threads.find((thread) => thread.id === activeThreadId) ?? null, [activeThreadId, threads])
  const slideThreads = useMemo(() => threads.filter((thread) => thread.slideId === slideId), [slideId, threads])

  const load = useCallback(async (): Promise<DiscussionThread[]> => {
    const result = await api<{ discussions: DiscussionThread[] }>(`/api/share/${encodeURIComponent(shareToken)}/discussions`)
    if (!draggingThreadIdRef.current) setThreads(result.discussions)
    setError(null)
    return result.discussions
  }, [shareToken])

  const openComposerAt = useCallback((clientX: number, clientY: number): boolean => {
    const bounds = layerRef.current?.getBoundingClientRect()
    if (!bounds) return false
    const anchor = commentAnchorFromClientPoint(clientX, clientY, bounds)
    if (!anchor) return false
    setActiveThreadId(null)
    setDraft(anchor)
    setPanelAnchor({ point: { x: clientX, y: clientY } })
    setError(null)
    return true
  }, [])

  useImperativeHandle(forwardedRef, () => ({ openComposerAt }), [openComposerAt])

  const close = useCallback((): void => {
    setActiveThreadId(null)
    setDraft(null)
    setPanelAnchor(null)
    setDraftPinElement(null)
    setError(null)
  }, [])

  useEffect(() => {
    if (!enabled) {
      close()
      return
    }
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : 'Discussions could not be loaded.'))
    const interval = window.setInterval(() => void load().catch(() => undefined), 8_000)
    return () => window.clearInterval(interval)
  }, [close, enabled, load])

  useEffect(() => close(), [close, slideId])

  useEffect(() => () => {
    dragCleanupRef.current?.()
    if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
  }, [])

  // Another participant or the owner may remove the open discussion between
  // polls. Close all local anchor state with it rather than leaving a ghost UI.
  useEffect(() => {
    if (activeThreadId && !activeThread) close()
  }, [activeThread, activeThreadId, close])

  useLayoutEffect(() => {
    if (!activeThreadId || draft) return
    const element = pinElementsRef.current.get(activeThreadId)
    if (!element) return
    setPanelAnchor((current) => {
      if (!current || current.element === element) return current
      return { ...current, element }
    })
  }, [activeThreadId, draft, slideThreads])

  const mutate = async <T extends { discussions: DiscussionThread[] }>(work: () => Promise<T>): Promise<T> => {
    setBusy(true)
    setError(null)
    try {
      const result = await work()
      // Mutation responses carry the committed discussion list. Keeping the
      // write and UI refresh in one response prevents a successful write from
      // being misreported as failed by a second network request.
      setThreads(result.discussions)
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The discussion could not be updated.')
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const create = async (body: string, requestId: string): Promise<void> => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ threadId: string; discussions: DiscussionThread[] }>(`/api/share/${encodeURIComponent(shareToken)}/discussions`, {
        method: 'POST',
        body: JSON.stringify({ slideId, x: draft.x, y: draft.y, body, requestId })
      })
      setThreads(result.discussions)
      setDraft(null)
      setDraftPinElement(null)
      setActiveThreadId(result.threadId)
      const thread = result.discussions.find((candidate) => candidate.id === result.threadId)
      if (!thread) close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The discussion could not be created.')
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const openThread = (thread: DiscussionThread, element: HTMLButtonElement): void => {
    const rect = element.getBoundingClientRect()
    setDraft(null)
    setActiveThreadId(thread.id)
    setPanelAnchor({ element, point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })
  }

  const beginPinInteraction = (event: React.PointerEvent<HTMLButtonElement>, thread: DiscussionThread): void => {
    if (!event.isPrimary || event.button !== 0 || !thread.canMove) return
    event.stopPropagation()
    const bounds = layerRef.current?.getBoundingClientRect()
    if (!bounds) return
    dragCleanupRef.current?.()
    const origin = { x: thread.x, y: thread.y }
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    let dragged = false
    let latest = origin

    const cleanup = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', complete)
      window.removeEventListener('pointercancel', cancel)
      dragCleanupRef.current = null
    }
    const restore = (): void => {
      draggingThreadIdRef.current = null
      setDraggingThreadId(null)
      setThreads((current) => current.map((candidate) => candidate.id === thread.id ? { ...candidate, ...origin } : candidate))
    }
    const move = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return
      const deltaX = pointerEvent.clientX - startX
      const deltaY = pointerEvent.clientY - startY
      if (!dragged && Math.hypot(deltaX, deltaY) < PIN_DRAG_THRESHOLD) return
      pointerEvent.preventDefault()
      if (!dragged) {
        dragged = true
        draggingThreadIdRef.current = thread.id
        setDraggingThreadId(thread.id)
        setActiveThreadId(null)
        setPanelAnchor(null)
      }
      const moved = moveCommentAnchor(origin, deltaX, deltaY, bounds)
      if (!moved) return
      latest = moved
      setThreads((current) => current.map((candidate) => candidate.id === thread.id ? { ...candidate, ...moved } : candidate))
    }
    const complete = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return
      cleanup()
      if (!dragged) return
      suppressedClickThreadRef.current = thread.id
      if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressedClickThreadRef.current = null
        suppressClickTimerRef.current = null
      }, 0)
      draggingThreadIdRef.current = null
      setDraggingThreadId(null)
      void api<{ discussions: DiscussionThread[] }>(`/api/share/${encodeURIComponent(shareToken)}/discussions/${thread.id}`, {
        method: 'PATCH',
        body: JSON.stringify(latest)
      }).then((result) => {
        setThreads(result.discussions)
        setError(null)
      }).catch((cause) => {
        restore()
        setError(cause instanceof Error ? cause.message : 'The discussion could not be moved.')
        void load().catch(() => undefined)
      })
    }
    const cancel = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) return
      cleanup()
      if (dragged) restore()
    }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', complete)
    window.addEventListener('pointercancel', cancel)
    dragCleanupRef.current = cleanup
  }

  return (
    <div
      aria-hidden={!enabled}
      className="comment-pin-layer"
      data-enabled={enabled}
      onClick={(event) => {
        if (!enabled || event.target !== event.currentTarget) return
        openComposerAt(event.clientX, event.clientY)
      }}
      ref={layerRef}
    >
      {enabled && slideThreads.map((thread) => (
        <button
          aria-label={`Open discussion with ${thread.comments.length} ${thread.comments.length === 1 ? 'comment' : 'comments'}`}
          className="comment-pin"
          data-active={activeThreadId === thread.id}
          data-dragging={draggingThreadId === thread.id}
          data-movable={thread.canMove}
          data-no-pan
          key={thread.id}
          onClick={(event) => {
            event.stopPropagation()
            if (suppressedClickThreadRef.current === thread.id) {
              event.preventDefault()
              suppressedClickThreadRef.current = null
              if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
              suppressClickTimerRef.current = null
              return
            }
            openThread(thread, event.currentTarget)
          }}
          onDragStart={(event) => event.preventDefault()}
          onPointerDown={(event) => beginPinInteraction(event, thread)}
          ref={(element) => {
            if (element) pinElementsRef.current.set(thread.id, element)
            else pinElementsRef.current.delete(thread.id)
          }}
          style={{ left: `${thread.x * 100}%`, top: `${thread.y * 100}%` }}
          type="button"
        >
          {thread.comments.length}
        </button>
      ))}
      {draft && <span aria-hidden="true" className="comment-pin comment-pin-draft" ref={setDraftPinElement} style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}>1</span>}
      {enabled && panelAnchor && (draft || activeThread) && (
        <DiscussionPanel
          anchor={draft && draftPinElement ? { ...panelAnchor, element: draftPinElement } : panelAnchor}
          busy={busy}
          draft={draft}
          error={error}
          onClose={close}
          onCreate={create}
          onDeleteComment={async (comment) => {
            if (!activeThread) return
            const result = await mutate(() => api<{ threadDeleted: boolean; discussions: DiscussionThread[] }>(`/api/share/${encodeURIComponent(shareToken)}/discussions/${activeThread.id}/comments/${comment.id}`, { method: 'DELETE', body: '{}' }))
            if (result.threadDeleted) close()
          }}
          onDeleteThread={async () => {
            if (!activeThread) return
            await mutate(() => api<{ discussions: DiscussionThread[] }>(`/api/share/${encodeURIComponent(shareToken)}/discussions/${activeThread.id}`, { method: 'DELETE', body: '{}' }))
            close()
          }}
          onEditComment={async (comment, body) => {
            if (!activeThread) return
            await mutate(() => api<{ discussions: DiscussionThread[] }>(`/api/share/${encodeURIComponent(shareToken)}/discussions/${activeThread.id}/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ body }) }))
          }}
          onReply={async (body, requestId) => {
            if (!activeThread) return
            await mutate(() => api<{ discussions: DiscussionThread[] }>(`/api/share/${encodeURIComponent(shareToken)}/discussions/${activeThread.id}/comments`, { method: 'POST', body: JSON.stringify({ body, requestId }) }))
          }}
          thread={activeThread}
        />
      )}
    </div>
  )
})

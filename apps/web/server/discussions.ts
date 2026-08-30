import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { parsePresentationDocument, type PresentationDocument } from '../../../src/shared/presentation'
import { type AuthenticatedUser, withTransaction } from './database'
import { coordinateToPpm, normalizeCommentBody, normalizeSlideId, ppmToCoordinate } from './commentValidation'
import { ApiError, jsonBody } from './http'
import { hashToken } from './security'

interface DiscussionRoutesOptions {
  app: FastifyInstance
  pool: Pool
  requireUser: (request: FastifyRequest) => Promise<AuthenticatedUser>
}

interface PublishedContext {
  document: PresentationDocument
  presentationId: string
}

interface DiscussionRow extends QueryResultRow {
  thread_id: string
  slide_id: string
  position_x_ppm: number
  position_y_ppm: number
  thread_created_by: string | null
  thread_created_at: Date
  thread_updated_at: Date
  comment_id: string
  body: string
  comment_created_at: Date
  comment_updated_at: Date
  author_id: string | null
  author_name: string
  author_title: string
  current_author_id: string | null
  current_display_name: string | null
  current_title: string | null
  avatar_mime_type: string | null
  avatar_updated_at: Date | null
  author_deleted_at: Date | null
}

type DatabaseReader = Pick<Pool | PoolClient, 'query'>

async function publishedContext(pool: Pool, token: string): Promise<PublishedContext> {
  if (token.length < 32 || token.length > 128) throw new ApiError(404, 'This presentation link is unavailable.')
  const result = await pool.query<{ presentation_id: string; document: unknown }>(
    `SELECT presentations.id AS presentation_id, revisions.document
     FROM cueport_presentations presentations
     JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
     WHERE presentations.share_token_hash = $1 AND revisions.status = 'published'`,
    [hashToken(token)]
  )
  const row = result.rows[0]
  if (!row) throw new ApiError(404, 'This presentation link is unavailable.')
  return { presentationId: row.presentation_id, document: parsePresentationDocument(row.document) }
}

function validSlideId(context: PublishedContext, value: unknown): string {
  let slideId: string
  try {
    slideId = normalizeSlideId(value)
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'The selected layout is invalid.')
  }
  if (!context.document.slides.some((slide) => slide.id === slideId)) {
    throw new ApiError(400, 'The selected layout is not part of this presentation.')
  }
  return slideId
}

function validBody(value: unknown): string {
  try {
    return normalizeCommentBody(value)
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'Write a valid comment.')
  }
}

function validCoordinates(xValue: unknown, yValue: unknown): { x: number; y: number } {
  try {
    return { x: coordinateToPpm(xValue), y: coordinateToPpm(yValue) }
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'Place the discussion inside the layout.')
  }
}

function requestId(value: unknown): string {
  if (value === undefined) return randomUUID()
  try {
    return normalizeSlideId(value)
  } catch {
    throw new ApiError(400, 'The discussion request identifier is invalid.')
  }
}

function avatarUrl(row: DiscussionRow): string | null {
  return row.current_author_id && !row.author_deleted_at && row.avatar_mime_type && row.avatar_updated_at
    ? `/api/users/${row.current_author_id}/avatar?v=${row.avatar_updated_at.getTime()}`
    : null
}

async function listDiscussions(database: DatabaseReader, presentationId: string, user: AuthenticatedUser): Promise<unknown[]> {
  const result = await database.query<DiscussionRow>(
    `SELECT
       threads.id AS thread_id,
       threads.slide_id,
       threads.position_x_ppm,
       threads.position_y_ppm,
       threads.created_by AS thread_created_by,
       threads.created_at AS thread_created_at,
       threads.updated_at AS thread_updated_at,
       comments.id AS comment_id,
       comments.body,
       comments.created_at AS comment_created_at,
       comments.updated_at AS comment_updated_at,
       comments.author_id,
       comments.author_name,
       comments.author_title,
       users.id AS current_author_id,
       users.display_name AS current_display_name,
       users.title AS current_title,
       users.avatar_mime_type,
       users.avatar_updated_at,
       users.deleted_at AS author_deleted_at
     FROM cueport_comment_threads threads
     JOIN cueport_comments comments ON comments.thread_id = threads.id
     LEFT JOIN cueport_users users ON users.id = comments.author_id
     WHERE threads.presentation_id = $1
     ORDER BY threads.updated_at DESC, comments.created_at DESC, comments.id DESC`,
    [presentationId]
  )
  const threads = new Map<string, {
    id: string
    slideId: string
    x: number
    y: number
    createdAt: string
    updatedAt: string
    canDelete: boolean
    canMove: boolean
    comments: unknown[]
  }>()
  for (const row of result.rows) {
    let thread = threads.get(row.thread_id)
    if (!thread) {
      thread = {
        id: row.thread_id,
        slideId: row.slide_id,
        x: ppmToCoordinate(row.position_x_ppm),
        y: ppmToCoordinate(row.position_y_ppm),
        createdAt: row.thread_created_at.toISOString(),
        updatedAt: row.thread_updated_at.toISOString(),
        canDelete: user.role === 'owner',
        canMove: row.thread_created_by === user.id || user.role === 'owner',
        comments: []
      }
      threads.set(row.thread_id, thread)
    }
    const accountExists = Boolean(row.current_author_id && !row.author_deleted_at)
    thread.comments.push({
      id: row.comment_id,
      body: row.body,
      createdAt: row.comment_created_at.toISOString(),
      updatedAt: row.comment_updated_at.toISOString(),
      edited: row.comment_updated_at.getTime() > row.comment_created_at.getTime() + 1000,
      canEdit: row.author_id === user.id,
      canDelete: row.author_id === user.id || user.role === 'owner',
      author: {
        id: accountExists ? row.current_author_id : null,
        displayName: accountExists ? row.current_display_name : 'Deleted account',
        title: accountExists ? row.current_title : '',
        avatarUrl: avatarUrl(row)
      }
    })
  }
  return [...threads.values()]
}

export function registerDiscussionRoutes({ app, pool, requireUser }: DiscussionRoutesOptions): void {
  app.get('/api/share/:token/discussions', async (request) => {
    const user = await requireUser(request)
    const { token } = request.params as { token: string }
    const context = await publishedContext(pool, token)
    return { discussions: await listDiscussions(pool, context.presentationId, user) }
  })

  app.post('/api/share/:token/discussions', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request)
    const { token } = request.params as { token: string }
    const context = await publishedContext(pool, token)
    const body = jsonBody(request.body)
    const slideId = validSlideId(context, body.slideId)
    const comment = validBody(body.body)
    const { x, y } = validCoordinates(body.x, body.y)
    let threadId: string = randomUUID()
    const commentId = requestId(body.requestId)
    const client = await pool.connect()
    let discussions: unknown[]
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [commentId])
      const existing = await client.query<{ thread_id: string }>(
        `SELECT comments.thread_id
         FROM cueport_comments comments
         JOIN cueport_comment_threads threads ON threads.id = comments.thread_id
         WHERE comments.id = $1 AND comments.author_id = $2 AND threads.presentation_id = $3`,
        [commentId, user.id, context.presentationId]
      )
      if (existing.rows[0]) {
        threadId = existing.rows[0].thread_id
      } else {
        await client.query(
          `INSERT INTO cueport_comment_threads
             (id, presentation_id, slide_id, position_x_ppm, position_y_ppm, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [threadId, context.presentationId, slideId, x, y, user.id]
        )
        await client.query(
          `INSERT INTO cueport_comments
             (id, thread_id, author_id, author_name, author_title, body)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [commentId, threadId, user.id, user.display_name, user.title, comment]
        )
      }
      discussions = await listDiscussions(client, context.presentationId, user)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    return {
      threadId,
      commentId,
      discussions
    }
  })

  app.patch('/api/share/:token/discussions/:threadId', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request)
    const { token, threadId } = request.params as { token: string; threadId: string }
    const context = await publishedContext(pool, token)
    const body = jsonBody(request.body)
    const { x, y } = validCoordinates(body.x, body.y)
    const discussions = await withTransaction(pool, async (client) => {
      const result = await client.query<{ created_by: string | null }>(
        `SELECT created_by FROM cueport_comment_threads
         WHERE id = $1 AND presentation_id = $2
         FOR UPDATE`,
        [threadId, context.presentationId]
      )
      const thread = result.rows[0]
      if (!thread) throw new ApiError(404, 'The discussion does not exist.')
      if (thread.created_by !== user.id && user.role !== 'owner') {
        throw new ApiError(403, 'You can only move discussions you created.')
      }
      // Moving a pin is spatial editing, not new discussion activity. Preserve
      // updated_at so repositioning does not reorder the conversation list.
      await client.query(
        `UPDATE cueport_comment_threads
         SET position_x_ppm = $1, position_y_ppm = $2
         WHERE id = $3`,
        [x, y, threadId]
      )
      return listDiscussions(client, context.presentationId, user)
    })
    return { success: true, discussions }
  })

  app.post('/api/share/:token/discussions/:threadId/comments', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request)
    const { token, threadId } = request.params as { token: string; threadId: string }
    const context = await publishedContext(pool, token)
    const body = jsonBody(request.body)
    const comment = validBody(body.body)
    const commentId = requestId(body.requestId)
    const discussions = await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [commentId])
      const thread = await client.query(
        'SELECT 1 FROM cueport_comment_threads WHERE id = $1 AND presentation_id = $2 FOR UPDATE',
        [threadId, context.presentationId]
      )
      if (!thread.rowCount) throw new ApiError(404, 'The discussion does not exist.')
      const existing = await client.query(
        `SELECT 1 FROM cueport_comments
         WHERE id = $1 AND thread_id = $2 AND author_id = $3`,
        [commentId, threadId, user.id]
      )
      if (!existing.rowCount) {
        await client.query(
          `INSERT INTO cueport_comments (id, thread_id, author_id, author_name, author_title, body)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [commentId, threadId, user.id, user.display_name, user.title, comment]
        )
        await client.query('UPDATE cueport_comment_threads SET updated_at = now() WHERE id = $1', [threadId])
      }
      return listDiscussions(client, context.presentationId, user)
    })
    return {
      commentId,
      discussions
    }
  })

  app.patch('/api/share/:token/discussions/:threadId/comments/:commentId', async (request) => {
    const user = await requireUser(request)
    const { token, threadId, commentId } = request.params as { token: string; threadId: string; commentId: string }
    const context = await publishedContext(pool, token)
    const body = validBody(jsonBody(request.body).body)
    const discussions = await withTransaction(pool, async (client) => {
      const result = await client.query<{ author_id: string | null }>(
        `SELECT comments.author_id
         FROM cueport_comments comments
         JOIN cueport_comment_threads threads ON threads.id = comments.thread_id
         WHERE comments.id = $1 AND threads.id = $2 AND threads.presentation_id = $3
         FOR UPDATE`,
        [commentId, threadId, context.presentationId]
      )
      const comment = result.rows[0]
      if (!comment) throw new ApiError(404, 'The comment does not exist.')
      if (comment.author_id !== user.id) throw new ApiError(403, 'You can only rewrite your own comments.')
      await client.query('UPDATE cueport_comments SET body = $1, updated_at = now() WHERE id = $2', [body, commentId])
      await client.query('UPDATE cueport_comment_threads SET updated_at = now() WHERE id = $1', [threadId])
      return listDiscussions(client, context.presentationId, user)
    })
    return {
      success: true,
      discussions
    }
  })

  app.delete('/api/share/:token/discussions/:threadId/comments/:commentId', async (request) => {
    const user = await requireUser(request)
    const { token, threadId, commentId } = request.params as { token: string; threadId: string; commentId: string }
    const context = await publishedContext(pool, token)
    const client = await pool.connect()
    let threadDeleted = false
    let discussions: unknown[]
    try {
      await client.query('BEGIN')
      const result = await client.query<{ author_id: string | null }>(
        `SELECT comments.author_id
         FROM cueport_comments comments
         JOIN cueport_comment_threads threads ON threads.id = comments.thread_id
         WHERE comments.id = $1 AND threads.id = $2 AND threads.presentation_id = $3
         FOR UPDATE`,
        [commentId, threadId, context.presentationId]
      )
      const comment = result.rows[0]
      if (!comment) throw new ApiError(404, 'The comment does not exist.')
      if (comment.author_id !== user.id && user.role !== 'owner') {
        throw new ApiError(403, 'You can only delete your own comments.')
      }
      await client.query('DELETE FROM cueport_comments WHERE id = $1', [commentId])
      const remaining = await client.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM cueport_comments WHERE thread_id = $1',
        [threadId]
      )
      threadDeleted = Number(remaining.rows[0]?.count ?? 0) === 0
      if (threadDeleted) await client.query('DELETE FROM cueport_comment_threads WHERE id = $1 AND presentation_id = $2', [threadId, context.presentationId])
      else await client.query('UPDATE cueport_comment_threads SET updated_at = now() WHERE id = $1', [threadId])
      discussions = await listDiscussions(client, context.presentationId, user)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    return {
      success: true,
      threadDeleted,
      discussions
    }
  })

  app.delete('/api/share/:token/discussions/:threadId', async (request) => {
    const user = await requireUser(request)
    if (user.role !== 'owner') throw new ApiError(403, 'Only the Cueport owner can delete an entire discussion.')
    const { token, threadId } = request.params as { token: string; threadId: string }
    const context = await publishedContext(pool, token)
    const discussions = await withTransaction(pool, async (client) => {
      const result = await client.query(
        'DELETE FROM cueport_comment_threads WHERE id = $1 AND presentation_id = $2',
        [threadId, context.presentationId]
      )
      if (!result.rowCount) throw new ApiError(404, 'The discussion does not exist.')
      return listDiscussions(client, context.presentationId, user)
    })
    return {
      success: true,
      discussions
    }
  })
}

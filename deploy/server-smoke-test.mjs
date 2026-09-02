import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

const baseUrl = process.env.CUEPORT_SMOKE_BASE_URL || 'http://127.0.0.1:3002'
const publicUrl = (process.env.CUEPORT_SMOKE_PUBLIC_URL || 'https://cueport.steveschreiner.de').replace(/\/$/, '')
const token = process.env.CUEPORT_SMOKE_TOKEN
if (!token) throw new Error('CUEPORT_SMOKE_TOKEN is required.')
const checkAccounts = process.env.CUEPORT_SMOKE_ACCOUNTS === 'true'

const headers = { Authorization: `Bearer ${token}` }
const presentationId = randomUUID()
const slideId = randomUUID()
const now = new Date().toISOString()
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const document = {
  schemaVersion: 1,
  id: presentationId,
  name: 'Cueport deployment check',
  createdAt: now,
  updatedAt: now,
  activeSlideId: slideId,
  settings: {},
  slides: [{
    id: slideId,
    name: 'Check.png',
    width: 1,
    height: 1,
    assetKey: 'slides/check.png',
    mimeType: 'image/png'
  }],
  references: [],
  brand: null
}

let temporaryAccountId = null

async function json(response) {
  const body = await response.json().catch(() => null)
  assert.equal(response.ok, true, body?.error || `Unexpected HTTP ${response.status}`)
  return body
}

try {
  const draft = await json(await fetch(`${baseUrl}/api/publications/drafts`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document,
      assets: [{ key: 'slides/check.png', mimeType: 'image/png', bytes: png.length }]
    })
  }))
  assert.equal(draft.uploads.length, 1)

  await json(await fetch(new URL(draft.uploads[0].url, baseUrl), {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'image/png',
      'Content-Length': String(png.length)
    },
    body: png
  }))
  const published = await json(await fetch(`${baseUrl}/api/publications/revisions/${draft.revisionId}/commit`, {
    method: 'POST',
    headers
  }))
  assert.equal(published.shareUrl.startsWith(`${publicUrl}/p/`), true)

  const shared = await json(await fetch(published.shareUrl.replace('/p/', '/api/share/'), { headers }))
  assert.equal(shared.document.id, presentationId)
  const assetResponse = await fetch(new URL(shared.assets['slides/check.png'], baseUrl), { headers })
  assert.equal(assetResponse.status, 200)
  assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), png)

  const shareToken = published.shareUrl.split('/p/')[1]
  const discussionBase = `${baseUrl}/api/share/${encodeURIComponent(shareToken)}/discussions`
  const threadRequestId = randomUUID()
  const threadRequest = JSON.stringify({ slideId, x: 0.25, y: 0.5, body: 'Deployment discussion check', requestId: threadRequestId })
  const first = await json(await fetch(discussionBase, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: threadRequest
  }))
  const retriedFirst = await json(await fetch(discussionBase, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: threadRequest
  }))
  assert.equal(retriedFirst.threadId, first.threadId)
  assert.equal(retriedFirst.commentId, first.commentId)
  assert.equal(retriedFirst.discussions[0].comments.length, 1)
  const movedThread = await json(await fetch(`${discussionBase}/${first.threadId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 0.4, y: 0.6 })
  }))
  assert.equal(movedThread.discussions[0].x, 0.4)
  assert.equal(movedThread.discussions[0].y, 0.6)
  const replyRequestId = randomUUID()
  const replyRequest = JSON.stringify({ body: 'Reply check', requestId: replyRequestId })
  const reply = await json(await fetch(`${discussionBase}/${first.threadId}/comments`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: replyRequest
  }))
  const retriedReply = await json(await fetch(`${discussionBase}/${first.threadId}/comments`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: replyRequest
  }))
  assert.equal(retriedReply.commentId, reply.commentId)
  assert.equal(retriedReply.discussions[0].comments.length, 2)
  await json(await fetch(`${discussionBase}/${first.threadId}/comments/${reply.commentId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'Edited reply check' })
  }))
  const listed = await json(await fetch(discussionBase, { headers }))
  assert.equal(listed.discussions[0].comments[0].body, 'Edited reply check')
  await json(await fetch(`${discussionBase}/${first.threadId}/comments/${reply.commentId}`, { method: 'DELETE', headers }))
  const finalDelete = await json(await fetch(`${discussionBase}/${first.threadId}/comments/${first.commentId}`, { method: 'DELETE', headers }))
  assert.equal(finalDelete.threadDeleted, true)

  if (checkAccounts) {
    const ownerSession = await json(await fetch(`${baseUrl}/api/session`, { headers }))
    const email = `smoke-${presentationId}@example.test`
    const createdAccount = await json(await fetch(`${baseUrl}/api/accounts`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName: 'Smoke Reviewer', role: 'viewer', title: 'Client review' })
    }))
    temporaryAccountId = createdAccount.account.id
    assert.equal(createdAccount.account.protected, false)
    assert.equal(createdAccount.account.role, 'viewer')

    const attemptedOwnerCreation = await fetch(`${baseUrl}/api/accounts`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `owner-${email}`, displayName: 'Invalid Owner', role: 'owner', title: '' })
    })
    assert.equal(attemptedOwnerCreation.status, 400)

    await json(await fetch(`${baseUrl}/api/presentations/${presentationId}/access`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic: false, accountIds: [createdAccount.account.id] })
    }))

    const ownerDelete = await fetch(`${baseUrl}/api/accounts/${ownerSession.user.id}`, { method: 'DELETE', headers })
    assert.equal(ownerDelete.status, 403)

    const activationToken = new URL(createdAccount.setupUrl).searchParams.get('activate')
    assert.ok(activationToken)
    const initialPassword = `Smoke-${randomBytes(24).toString('base64url')}`
    const activation = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: activationToken, password: initialPassword })
    })
    const activated = await json(activation)
    assert.equal(activated.user.role, 'viewer')
    const memberCookie = activation.headers.get('set-cookie')?.split(';')[0]
    assert.ok(memberCookie)
    let memberHeaders = { Cookie: memberCookie, Origin: publicUrl }

    const passwordLink = await json(await fetch(`${baseUrl}/api/accounts/${createdAccount.account.id}/password-link`, {
      method: 'POST',
      headers
    }))
    const passwordToken = new URL(passwordLink.passwordUrl).searchParams.get('activate')
    assert.ok(passwordToken)
    const passwordLinkDetails = await json(await fetch(`${baseUrl}/api/auth/invite/${encodeURIComponent(passwordToken)}`))
    assert.equal(passwordLinkDetails.active, true)
    const resetPassword = `Reset-${randomBytes(24).toString('base64url')}`
    const reset = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: passwordToken, password: resetPassword })
    })
    await json(reset)
    const resetCookie = reset.headers.get('set-cookie')?.split(';')[0]
    assert.ok(resetCookie)
    const staleActivationSession = await json(await fetch(`${baseUrl}/api/session`, { headers: { Cookie: memberCookie } }))
    assert.equal(staleActivationSession.authenticated, false)
    memberHeaders = { Cookie: resetCookie, Origin: publicUrl }

    const wrongCurrentPassword = await fetch(`${baseUrl}/api/profile/password`, {
      method: 'POST',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'incorrect password', newPassword: `Unused-${randomBytes(24).toString('base64url')}` })
    })
    assert.equal(wrongCurrentPassword.status, 401)
    const changedPassword = `Changed-${randomBytes(24).toString('base64url')}`
    const passwordChange = await fetch(`${baseUrl}/api/profile/password`, {
      method: 'POST',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: resetPassword, newPassword: changedPassword })
    })
    await json(passwordChange)
    const changedCookie = passwordChange.headers.get('set-cookie')?.split(';')[0]
    assert.ok(changedCookie)
    const staleResetSession = await json(await fetch(`${baseUrl}/api/session`, { headers: { Cookie: resetCookie } }))
    assert.equal(staleResetSession.authenticated, false)
    memberHeaders = { Cookie: changedCookie, Origin: publicUrl }

    const forbiddenViewerManagement = await fetch(`${baseUrl}/api/presentations/${presentationId}/access`, {
      headers: memberHeaders
    })
    assert.equal(forbiddenViewerManagement.status, 403)
    const forbiddenViewerDraft = await fetch(`${baseUrl}/api/publications/drafts`, {
      method: 'POST',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ document, assets: [] })
    })
    assert.equal(forbiddenViewerDraft.status, 403)

    await json(await fetch(`${baseUrl}/api/accounts/${createdAccount.account.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' })
    }))
    const editorAccess = await json(await fetch(`${baseUrl}/api/presentations/${presentationId}/access`, {
      headers: memberHeaders
    }))
    assert.equal(editorAccess.isPublic, false)
    const desktopEditorLogin = await json(await fetch(`${baseUrl}/api/desktop/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: changedPassword })
    }))
    assert.ok(desktopEditorLogin.token)

    const ownerOnlyThread = await json(await fetch(discussionBase, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId, x: 0.1, y: 0.1, body: 'Owner movement permission check' })
    }))
    const forbiddenMove = await fetch(`${discussionBase}/${ownerOnlyThread.threadId}`, {
      method: 'PATCH',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0.2, y: 0.2 })
    })
    assert.equal(forbiddenMove.status, 403)
    await json(await fetch(`${discussionBase}/${ownerOnlyThread.threadId}`, { method: 'DELETE', headers }))

    await json(await fetch(`${baseUrl}/api/profile`, {
      method: 'PATCH',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Smoke Reviewer', title: 'Updated reviewer' })
    }))
    await json(await fetch(`${baseUrl}/api/share/${encodeURIComponent(shareToken)}`, { headers: memberHeaders }))
    const memberThread = await json(await fetch(discussionBase, {
      method: 'POST',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId, x: 0.75, y: 0.25, body: 'https://example.com member check' })
    }))
    const memberMoved = await json(await fetch(`${discussionBase}/${memberThread.threadId}`, {
      method: 'PATCH',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0.7, y: 0.3 })
    }))
    assert.equal(memberMoved.discussions[0].x, 0.7)
    assert.equal(memberMoved.discussions[0].y, 0.3)
    await json(await fetch(`${discussionBase}/${memberThread.threadId}/comments/${memberThread.commentId}`, {
      method: 'PATCH',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'https://example.com edited member check' })
    }))
    const forbiddenThreadDelete = await fetch(`${discussionBase}/${memberThread.threadId}`, { method: 'DELETE', headers: memberHeaders })
    assert.equal(forbiddenThreadDelete.status, 403)

    await json(await fetch(`${baseUrl}/api/accounts/${createdAccount.account.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' })
    }))
    const adminAccounts = await json(await fetch(`${baseUrl}/api/accounts`, { headers: memberHeaders }))
    assert.equal(adminAccounts.accounts.some((account) => account.role === 'owner' && account.protected), true)
    const adminOwnerDelete = await fetch(`${baseUrl}/api/accounts/${ownerSession.user.id}`, { method: 'DELETE', headers: memberHeaders })
    assert.equal(adminOwnerDelete.status, 403)

    await json(await fetch(`${baseUrl}/api/accounts/${createdAccount.account.id}`, { method: 'DELETE', headers }))
    const afterAccountDelete = await json(await fetch(discussionBase, { headers }))
    assert.equal(afterAccountDelete.discussions[0].comments[0].author.displayName, 'Deleted account')
    assert.equal(afterAccountDelete.discussions[0].comments[0].canDelete, true)
    await json(await fetch(`${discussionBase}/${memberThread.threadId}`, { method: 'DELETE', headers }))
  }

  await json(await fetch(`${baseUrl}/api/presentations/${presentationId}`, { method: 'DELETE', headers }))
  console.log('Cueport publication smoke test passed.')
} finally {
  if (temporaryAccountId) {
    await fetch(`${baseUrl}/api/accounts/${temporaryAccountId}`, { method: 'DELETE', headers }).catch(() => undefined)
  }
  await fetch(`${baseUrl}/api/presentations/${presentationId}`, { method: 'DELETE', headers }).catch(() => undefined)
}

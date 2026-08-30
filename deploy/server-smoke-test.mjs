import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const baseUrl = process.env.CUEPORT_SMOKE_BASE_URL || 'http://127.0.0.1:3002'
const token = process.env.CUEPORT_SMOKE_TOKEN
if (!token) throw new Error('CUEPORT_SMOKE_TOKEN is required.')

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
  assert.match(published.shareUrl, /^https:\/\/cueport\.steveschreiner\.de\/p\//)

  const shared = await json(await fetch(published.shareUrl.replace('/p/', '/api/share/')))
  assert.equal(shared.document.id, presentationId)
  const assetResponse = await fetch(new URL(shared.assets['slides/check.png'], baseUrl))
  assert.equal(assetResponse.status, 200)
  assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), png)

  await json(await fetch(`${baseUrl}/api/presentations/${presentationId}`, { method: 'DELETE', headers }))
  console.log('Cueport publication smoke test passed.')
} catch (error) {
  await fetch(`${baseUrl}/api/presentations/${presentationId}`, { method: 'DELETE', headers }).catch(() => undefined)
  throw error
}

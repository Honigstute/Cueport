import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import type {
  PublicationSource,
  PublishingResult,
  PublishingSignInRequest,
  PublishingStatus
} from '../shared/projects'

const DEFAULT_SERVER_URL = 'https://cueport.steveschreiner.de'
const DEFAULT_OWNER_EMAIL = 'stevedotschreiner@gmail.com'

interface StoredPublishingCredentials {
  version: 1
  serverUrl: string
  email: string
  encryptedToken: string
}

interface PublishingHandlersOptions {
  credentialsPath: string
  isTrustedRenderer: (event: IpcMainInvokeEvent) => boolean
  loadPublication: (presentationId: unknown) => Promise<PublicationSource>
}

function validateServerUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter the Cueport server address.')
  const url = new URL(value.trim())
  const isLocalDevelopment = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
  if (url.protocol !== 'https:' && !isLocalDevelopment) throw new Error('The Cueport server must use a secure HTTPS address.')
  if (url.username || url.password || url.search || url.hash) throw new Error('Enter only the Cueport server address.')
  return url.origin
}

function validateEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter your owner email address.')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter your owner email address.')
  return email
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new Error(body?.error || `The Cueport server returned ${response.status}.`)
  return body as T
}

export function configurePublishingHandlers(options: PublishingHandlersOptions): void {
  const readCredentials = async (): Promise<(StoredPublishingCredentials & { token: string }) | null> => {
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      const parsed = JSON.parse(await readFile(options.credentialsPath, 'utf8')) as Partial<StoredPublishingCredentials>
      if (parsed.version !== 1 || typeof parsed.serverUrl !== 'string' || typeof parsed.email !== 'string' || typeof parsed.encryptedToken !== 'string') return null
      return {
        version: 1,
        serverUrl: validateServerUrl(parsed.serverUrl),
        email: validateEmail(parsed.email),
        encryptedToken: parsed.encryptedToken,
        token: safeStorage.decryptString(Buffer.from(parsed.encryptedToken, 'base64'))
      }
    } catch {
      return null
    }
  }

  const writeCredentials = async (credentials: { serverUrl: string; email: string; token: string }): Promise<void> => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this computer.')
    const stored: StoredPublishingCredentials = {
      version: 1,
      serverUrl: validateServerUrl(credentials.serverUrl),
      email: validateEmail(credentials.email),
      encryptedToken: safeStorage.encryptString(credentials.token).toString('base64')
    }
    await mkdir(dirname(options.credentialsPath), { recursive: true })
    const temporary = `${options.credentialsPath}.tmp`
    await writeFile(temporary, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, options.credentialsPath)
  }

  const status = async (): Promise<PublishingStatus> => {
    const credentials = await readCredentials()
    return credentials
      ? { signedIn: true, serverUrl: credentials.serverUrl, email: credentials.email }
      : { signedIn: false, serverUrl: DEFAULT_SERVER_URL, email: DEFAULT_OWNER_EMAIL }
  }

  ipcMain.handle('publishing:status', async (event) => {
    if (!options.isTrustedRenderer(event)) throw new Error('Untrusted publishing request.')
    return status()
  })

  ipcMain.handle('publishing:sign-in', async (event, candidate: unknown) => {
    if (!options.isTrustedRenderer(event)) throw new Error('Untrusted publishing request.')
    if (!candidate || typeof candidate !== 'object') throw new Error('The publishing sign-in is invalid.')
    const request = candidate as Partial<PublishingSignInRequest>
    const serverUrl = validateServerUrl(request.serverUrl)
    const email = validateEmail(request.email)
    if (typeof request.password !== 'string' || !request.password) throw new Error('Enter your Cueport password.')
    const response = await fetch(`${serverUrl}/api/desktop/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: request.password }),
      signal: AbortSignal.timeout(20_000)
    })
    const result = await responseJson<{ token: string; email: string }>(response)
    if (typeof result.token !== 'string' || result.token.length < 32) throw new Error('The Cueport server returned an invalid desktop session.')
    await writeCredentials({ serverUrl, email: result.email, token: result.token })
    return status()
  })

  ipcMain.handle('publishing:sign-out', async (event) => {
    if (!options.isTrustedRenderer(event)) throw new Error('Untrusted publishing request.')
    await rm(options.credentialsPath, { force: true })
    return status()
  })

  ipcMain.handle('publishing:publish', async (event, presentationId: unknown): Promise<PublishingResult> => {
    if (!options.isTrustedRenderer(event)) throw new Error('Untrusted publishing request.')
    const credentials = await readCredentials()
    if (!credentials) throw new Error('Sign in to your Cueport server before publishing.')
    const publication = await options.loadPublication(presentationId)
    const draftResponse = await fetch(`${credentials.serverUrl}/api/publications/drafts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        document: publication.document,
        assets: publication.assets.map((asset) => ({ key: asset.key, mimeType: asset.mimeType, bytes: asset.bytes }))
      }),
      signal: AbortSignal.timeout(30_000)
    })
    const draft = await responseJson<{
      revisionId: string
      uploads: Array<{ key: string; url: string }>
    }>(draftResponse)
    const uploadByKey = new Map(draft.uploads.map((upload) => [upload.key, upload.url]))

    for (const asset of publication.assets) {
      const relativeUploadUrl = uploadByKey.get(asset.key)
      if (!relativeUploadUrl) throw new Error(`The server omitted the upload target for ${asset.key}.`)
      const uploadUrl = new URL(relativeUploadUrl, credentials.serverUrl)
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': asset.mimeType,
          'Content-Length': String(asset.bytes)
        },
        body: createReadStream(asset.filePath) as unknown as BodyInit,
        duplex: 'half',
        signal: AbortSignal.timeout(30 * 60_000)
      } as RequestInit & { duplex: 'half' })
      await responseJson<{ success: true }>(uploadResponse)
    }

    const commitResponse = await fetch(`${credentials.serverUrl}/api/publications/revisions/${encodeURIComponent(draft.revisionId)}/commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.token}` },
      signal: AbortSignal.timeout(30_000)
    })
    return responseJson<PublishingResult>(commitResponse)
  })
}

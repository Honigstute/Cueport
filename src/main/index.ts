import { app, BrowserWindow, ipcMain, Menu, protocol, session, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { OpenPresentationResult, SavePresentationRequest, SavedPresentationSummary } from '../shared/projects'
import {
  PRESENTATION_DOCUMENT_VERSION,
  mimeTypeFromFileName,
  parseDesktopPresentationFile,
  parsePresentationDocument,
  sanitizePresentationSettings,
  type PresentationDocument
} from '../shared/presentation'
import { resolveByteRange } from './httpRange'

const DEVELOPMENT_RENDERER_URL = process.env.ELECTRON_RENDERER_URL
const DEVELOPMENT_ICON = join(app.getAppPath(), 'build/icon.png')
const SUPPORTED_PRESENTATION_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4'])
const SUPPORTED_ASSET_EXTENSIONS = new Set([...SUPPORTED_PRESENTATION_EXTENSIONS, '.svg'])
const ASSET_SCHEME = 'cueport-asset'
const importedAssetPaths = new Map<string, string>()
const importedPathKeys = new Map<string, string>()
let mainWindow: BrowserWindow | null = null
let reopenScheduled = false
let isQuitting = false

protocol.registerSchemesAsPrivileged([{
  scheme: ASSET_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}])

app.name = 'Cueport'

// Development checks can use an isolated library without touching a person's
// real saved presentations. Packaged builds always use Electron's normal path.
const developmentUserData = process.env.CUEPORT_USER_DATA
if (!app.isPackaged && developmentUserData && isAbsolute(developmentUserData)) {
  app.setPath('userData', developmentUserData)
}

function configureApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function isTrustedRenderer(event: IpcMainInvokeEvent): boolean {
  return Boolean(BrowserWindow.fromWebContents(event.sender))
}

function validateAssetPath(filePath: unknown): string {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
    throw new Error('The selected media path is invalid.')
  }
  if (!SUPPORTED_ASSET_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new Error('Only imported JPEG, PNG, WebP, MP4, and SVG files are supported.')
  }
  return filePath
}

function validateRenamedFileName(currentPath: string, nextName: unknown): string {
  if (
    typeof nextName !== 'string' ||
    !nextName.trim() ||
    basename(nextName) !== nextName ||
    /[<>:"/\\|?*\u0000-\u001F]/.test(nextName) ||
    Buffer.byteLength(nextName, 'utf8') > 240
  ) {
    throw new Error('Use a short filename without slashes or reserved characters.')
  }
  if (extname(nextName).toLowerCase() !== extname(currentPath).toLowerCase()) {
    throw new Error('Keep the original file ending.')
  }
  return nextName.trim()
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function presentationsDirectory(): string {
  return join(app.getPath('userData'), 'presentations')
}

function presentationOrderPath(): string {
  return join(presentationsDirectory(), 'library-order.json')
}

async function readPresentationOrder(): Promise<string[]> {
  try {
    const candidate = JSON.parse(await readFile(presentationOrderPath(), 'utf8'))
    if (!Array.isArray(candidate)) return []
    const unique = new Set<string>()
    for (const id of candidate) {
      try {
        unique.add(validateProjectId(id))
      } catch {
        // A damaged entry must not hide otherwise valid saved presentations.
      }
    }
    return [...unique]
  } catch {
    return []
  }
}

async function writePresentationOrder(ids: string[]): Promise<void> {
  const directory = presentationsDirectory()
  await mkdir(directory, { recursive: true })
  const destination = presentationOrderPath()
  const temporary = join(directory, `library-order-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(ids, null, 2), 'utf8')
  await rename(temporary, destination)
}

function validateProjectId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error('The saved presentation identifier is invalid.')
  }
  return value
}

function validatePresentationName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a presentation name.')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name || /[\u0000-\u001F]/.test(name) || Buffer.byteLength(name, 'utf8') > 120) {
    throw new Error('Use a presentation name shorter than 120 characters.')
  }
  return name
}

function validateSlideId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error('One of the presentation items has an invalid identifier.')
  }
  return value
}

function registerAssetPath(filePath: string): string {
  const normalizedPath = resolve(filePath)
  const existingKey = importedPathKeys.get(normalizedPath)
  if (existingKey) return existingKey

  const sourceKey = randomUUID()
  importedAssetPaths.set(sourceKey, normalizedPath)
  importedPathKeys.set(normalizedPath, sourceKey)
  return sourceKey
}

function localAssetUrl(sourceKey: string): string {
  return `${ASSET_SCHEME}://local/${encodeURIComponent(sourceKey)}`
}

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.mp4': return 'video/mp4'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

function configureAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url)
    const sourceKey = decodeURIComponent(url.pathname.slice(1))
    const filePath = url.hostname === 'local' ? importedAssetPaths.get(sourceKey) : null
    if (!filePath) return new Response('Asset not found.', { status: 404 })

    try {
      const fileStats = await stat(filePath)
      if (!fileStats.isFile()) return new Response('Asset not found.', { status: 404 })
      const byteRange = resolveByteRange(request.headers.get('range'), fileStats.size)
      const commonHeaders = {
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': contentTypeForPath(filePath)
      }
      if (byteRange === null) {
        return new Response('Requested range is unavailable.', {
          status: 416,
          headers: { ...commonHeaders, 'Content-Range': `bytes */${fileStats.size}` }
        })
      }

      const stream = createReadStream(filePath, byteRange
        ? { start: byteRange.start, end: byteRange.end }
        : undefined)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: byteRange ? 206 : 200,
        headers: {
          ...commonHeaders,
          'Content-Length': String(byteRange?.length ?? fileStats.size),
          ...(byteRange && { 'Content-Range': `bytes ${byteRange.start}-${byteRange.end}/${fileStats.size}` })
        }
      })
    } catch {
      return new Response('Asset not found.', { status: 404 })
    }
  })
}

function projectDirectory(projectId: string): string {
  return join(presentationsDirectory(), validateProjectId(projectId))
}

function resolveProjectAsset(projectDir: string, assetKey: string): string {
  const root = resolve(projectDir)
  const candidate = resolve(projectDir, assetKey)
  const relativePath = relative(root, candidate)
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..' || isAbsolute(relativePath)) {
    throw new Error('A saved presentation contains an invalid asset reference.')
  }
  return candidate
}

async function readStoredPresentation(projectId: string): Promise<PresentationDocument> {
  const filePath = join(projectDirectory(projectId), 'project.json')
  return parseDesktopPresentationFile(JSON.parse(await readFile(filePath, 'utf8')))
}

async function writeStoredPresentation(project: PresentationDocument): Promise<void> {
  const directory = projectDirectory(project.id)
  await mkdir(directory, { recursive: true })
  const destination = join(directory, 'project.json')
  const temporary = join(directory, `project-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(project, null, 2), 'utf8')
  await rename(temporary, destination)
}

async function copyRegisteredAsset(sourceKey: string, destination: string): Promise<void> {
  const source = importedAssetPaths.get(sourceKey)
  if (!source) throw new Error('One of the original presentation files is no longer available.')
  await mkdir(dirname(destination), { recursive: true })
  if (resolve(source) !== resolve(destination)) await copyFile(source, destination)
}

function validateSaveRequest(candidate: unknown): SavePresentationRequest {
  if (!candidate || typeof candidate !== 'object') throw new Error('The presentation could not be saved.')
  const request = candidate as Partial<SavePresentationRequest>
  const id = request.id === null || request.id === undefined ? null : validateProjectId(request.id)
  const name = validatePresentationName(request.name)
  if (!Array.isArray(request.slides) || request.slides.length === 0 || request.slides.length > 500) {
    throw new Error('Add at least one image or video before saving the presentation.')
  }
  if (Array.isArray(request.references) && request.references.length > 500) {
    throw new Error('Keep the reference tray below 500 images.')
  }
  const validateRequestAssets = (
    assets: SavePresentationRequest['slides'],
    kind: 'presentation' | 'reference'
  ): SavePresentationRequest['slides'] => assets.map((asset) => {
    if (!asset || typeof asset !== 'object' || typeof asset.sourceKey !== 'string' || !importedAssetPaths.has(asset.sourceKey)) {
      throw new Error(`One of the original ${kind} files is no longer available.`)
    }
    const width = Number(asset.width)
    const height = Number(asset.height)
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 100000 || height > 100000) {
      throw new Error(`One of the ${kind} items has invalid dimensions.`)
    }
    if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 300) {
      throw new Error(`One of the ${kind} items has an invalid name.`)
    }
    const thumbnailDataUrl = typeof asset.thumbnailDataUrl === 'string' && asset.thumbnailDataUrl.length <= 2_000_000
      ? asset.thumbnailDataUrl
      : null
    return { id: validateSlideId(asset.id), name: asset.name, width, height, sourceKey: asset.sourceKey, thumbnailDataUrl }
  })
  const slides = validateRequestAssets(request.slides, 'presentation')
  const references = Array.isArray(request.references)
    ? validateRequestAssets(request.references, 'reference')
    : []
  const assetIds = [...slides, ...references].map((asset) => asset.id)
  if (new Set(assetIds).size !== assetIds.length) {
    throw new Error('Presentation and reference items must have unique identifiers.')
  }
  const activeSlideId = typeof request.activeSlideId === 'string' && slides.some((slide) => slide.id === request.activeSlideId)
    ? request.activeSlideId
    : slides[0].id
  const settings = sanitizePresentationSettings(request.settings)
  const settingsJson = JSON.stringify(settings)
  if (Buffer.byteLength(settingsJson, 'utf8') > 128 * 1024) throw new Error('The presentation settings are too large to save.')
  const brand = request.brand && typeof request.brand === 'object'
    ? {
        logoName: typeof request.brand.logoName === 'string' && request.brand.logoName.trim() && request.brand.logoName.length <= 300
          ? request.brand.logoName.trim()
          : null,
        sourceKey: typeof request.brand.sourceKey === 'string' && importedAssetPaths.has(request.brand.sourceKey)
          ? request.brand.sourceKey
          : null
      }
    : { logoName: null, sourceKey: null }
  const previewDataUrl = typeof request.previewDataUrl === 'string' && request.previewDataUrl.length <= 2_000_000
    ? request.previewDataUrl
    : null
  return { id, name, activeSlideId, settings, slides, references, brand, previewDataUrl }
}

function decodeJpegDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  return match ? Buffer.from(match[1], 'base64') : null
}

async function projectSummary(project: PresentationDocument): Promise<SavedPresentationSummary> {
  const directory = projectDirectory(project.id)
  const previewPath = join(directory, 'preview.jpg')
  const fallbackAssetKey = project.brand?.assetKey ??
    project.slides.find((slide) => slide.posterKey)?.posterKey ??
    project.slides.find((slide) => slide.mimeType.startsWith('image/'))?.assetKey
  const selectedPreview = await pathExists(previewPath)
    ? previewPath
    : fallbackAssetKey
      ? resolveProjectAsset(directory, fallbackAssetKey)
      : null
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    previewUrl: selectedPreview ? localAssetUrl(registerAssetPath(selectedPreview)) : null,
    slideCount: project.slides.length
  }
}

function configurePresentationHandlers(): void {
  ipcMain.handle('presentation:list', async (event) => {
    if (!isTrustedRenderer(event)) throw new Error('Untrusted presentation request.')
    await mkdir(presentationsDirectory(), { recursive: true })
    const entries = await readdir(presentationsDirectory(), { withFileTypes: true })
    const projects = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        return await readStoredPresentation(entry.name)
      } catch {
        return null
      }
    }))
    const summaries = await Promise.all(projects.filter((project): project is PresentationDocument => Boolean(project)).map(projectSummary))
    const newestFirst = summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    const summaryById = new Map(newestFirst.map((summary) => [summary.id, summary]))
    const ordered = (await readPresentationOrder())
      .map((id) => summaryById.get(id))
      .filter((summary): summary is SavedPresentationSummary => Boolean(summary))
    const orderedIds = new Set(ordered.map((summary) => summary.id))
    return [...ordered, ...newestFirst.filter((summary) => !orderedIds.has(summary.id))]
  })

  ipcMain.handle('presentation:save', async (event, candidate: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('Untrusted presentation request.')
    const request = validateSaveRequest(candidate)
    const id = request.id ?? randomUUID()
    const directory = projectDirectory(id)
    const existing = await pathExists(join(directory, 'project.json')) ? await readStoredPresentation(id) : null
    const now = new Date().toISOString()
    const slides: PresentationDocument['slides'] = []
    const references: PresentationDocument['references'] = []

    for (const slide of request.slides) {
      const sourcePath = importedAssetPaths.get(slide.sourceKey!)!
      const assetKey = `assets/${slide.id}${extname(sourcePath).toLowerCase()}`
      await copyRegisteredAsset(slide.sourceKey!, resolveProjectAsset(directory, assetKey))
      const poster = slide.thumbnailDataUrl ? decodeJpegDataUrl(slide.thumbnailDataUrl) : null
      const posterKey = poster ? `thumbnails/${slide.id}.jpg` : undefined
      if (poster && posterKey) {
        const posterPath = resolveProjectAsset(directory, posterKey)
        await mkdir(dirname(posterPath), { recursive: true })
        await writeFile(posterPath, poster)
      }
      slides.push({
        id: slide.id,
        name: slide.name,
        width: slide.width,
        height: slide.height,
        assetKey,
        mimeType: mimeTypeFromFileName(sourcePath),
        ...(posterKey && { posterKey })
      })
    }

    for (const reference of request.references) {
      const sourcePath = importedAssetPaths.get(reference.sourceKey!)!
      const assetKey = `references/${reference.id}${extname(sourcePath).toLowerCase()}`
      await copyRegisteredAsset(reference.sourceKey!, resolveProjectAsset(directory, assetKey))
      const poster = reference.thumbnailDataUrl ? decodeJpegDataUrl(reference.thumbnailDataUrl) : null
      const posterKey = poster ? `thumbnails/${reference.id}.jpg` : undefined
      if (poster && posterKey) {
        const posterPath = resolveProjectAsset(directory, posterKey)
        await mkdir(dirname(posterPath), { recursive: true })
        await writeFile(posterPath, poster)
      }
      references.push({
        id: reference.id,
        name: reference.name,
        width: reference.width,
        height: reference.height,
        assetKey,
        mimeType: mimeTypeFromFileName(sourcePath),
        ...(posterKey && { posterKey })
      })
    }

    let brand: PresentationDocument['brand'] = null
    if (request.brand.sourceKey && request.brand.logoName) {
      const sourcePath = importedAssetPaths.get(request.brand.sourceKey)!
      const assetKey = `assets/logo${extname(sourcePath).toLowerCase()}`
      await copyRegisteredAsset(request.brand.sourceKey, resolveProjectAsset(directory, assetKey))
      brand = {
        name: request.brand.logoName,
        assetKey,
        mimeType: mimeTypeFromFileName(sourcePath, true)
      }
    }

    const previewPath = join(directory, 'preview.jpg')
    const preview = request.previewDataUrl ? decodeJpegDataUrl(request.previewDataUrl) : null
    if (preview) await writeFile(previewPath, preview)
    else if (await pathExists(previewPath)) await unlink(previewPath)
    const project = parsePresentationDocument({
      schemaVersion: PRESENTATION_DOCUMENT_VERSION,
      id,
      name: request.name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      activeSlideId: request.activeSlideId ?? slides[0].id,
      settings: request.settings,
      slides,
      references,
      brand
    })
    await writeStoredPresentation(project)
    return projectSummary(project)
  })

  ipcMain.handle('presentation:open', async (event, candidateId: unknown): Promise<OpenPresentationResult> => {
    if (!isTrustedRenderer(event)) throw new Error('Untrusted presentation request.')
    const project = await readStoredPresentation(validateProjectId(candidateId))
    const directory = projectDirectory(project.id)
    const slides = project.slides.map((slide) => {
      const filePath = resolveProjectAsset(directory, slide.assetKey)
      const sourceKey = registerAssetPath(filePath)
      const url = localAssetUrl(sourceKey)
      const thumbnailUrl = slide.posterKey
        ? localAssetUrl(registerAssetPath(resolveProjectAsset(directory, slide.posterKey)))
        : url
      return { ...slide, sourceKey, url, thumbnailUrl }
    })
    const references = project.references.map((reference) => {
      const filePath = resolveProjectAsset(directory, reference.assetKey)
      const sourceKey = registerAssetPath(filePath)
      const url = localAssetUrl(sourceKey)
      const thumbnailUrl = reference.posterKey
        ? localAssetUrl(registerAssetPath(resolveProjectAsset(directory, reference.posterKey)))
        : url
      return { ...reference, sourceKey, url, thumbnailUrl }
    })
    const brand = project.brand
      ? (() => {
          const filePath = resolveProjectAsset(directory, project.brand!.assetKey)
          const sourceKey = registerAssetPath(filePath)
          return {
            logoName: project.brand!.name,
            assetKey: project.brand!.assetKey,
            mimeType: project.brand!.mimeType,
            sourceKey,
            url: localAssetUrl(sourceKey)
          }
        })()
      : null
    return { summary: await projectSummary(project), activeSlideId: project.activeSlideId, settings: project.settings, slides, references, brand }
  })

  ipcMain.handle('presentation:rename', async (event, candidateId: unknown, candidateName: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('Untrusted presentation request.')
    const project = await readStoredPresentation(validateProjectId(candidateId))
    const updated = { ...project, name: validatePresentationName(candidateName), updatedAt: new Date().toISOString() }
    await writeStoredPresentation(updated)
    return projectSummary(updated)
  })

  ipcMain.handle('presentation:delete', async (event, candidateId: unknown): Promise<void> => {
    if (!isTrustedRenderer(event)) throw new Error('Untrusted presentation request.')
    const id = validateProjectId(candidateId)
    const directory = projectDirectory(id)
    if (!await pathExists(join(directory, 'project.json'))) {
      throw new Error('The saved presentation no longer exists.')
    }

    // The exact project directory is validated before this irreversible action.
    await rm(directory, { recursive: true })
    await writePresentationOrder((await readPresentationOrder()).filter((orderedId) => orderedId !== id))
  })

  ipcMain.handle('presentation:reorder', async (event, candidateIds: unknown): Promise<void> => {
    if (!isTrustedRenderer(event)) throw new Error('Untrusted presentation request.')
    if (!Array.isArray(candidateIds) || candidateIds.length > 1000) {
      throw new Error('The presentation order is invalid.')
    }
    const ids = candidateIds.map(validateProjectId)
    if (new Set(ids).size !== ids.length) throw new Error('The presentation order contains duplicates.')

    const existingIds: string[] = []
    for (const id of ids) {
      if (await pathExists(join(projectDirectory(id), 'project.json'))) existingIds.push(id)
    }
    await writePresentationOrder(existingIds)
  })
}

function configureImportedAssetHandlers(): void {
  ipcMain.handle('asset:register', async (event, candidatePath: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('Untrusted media request.')
    const filePath = validateAssetPath(candidatePath)
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) throw new Error('The selected media is not a file.')
    return registerAssetPath(filePath)
  })

  ipcMain.handle('asset:rename', async (event, sourceKey: unknown, candidateName: unknown) => {
    if (!isTrustedRenderer(event) || typeof sourceKey !== 'string') {
      throw new Error('Untrusted rename request.')
    }

    const currentPath = importedAssetPaths.get(sourceKey)
    if (!currentPath) throw new Error('The original file is no longer available to rename.')
    const nextName = validateRenamedFileName(currentPath, candidateName)
    const nextPath = join(dirname(currentPath), nextName)
    if (nextPath === currentPath) return { name: nextName }

    const isCaseOnlyRename = nextPath.toLowerCase() === currentPath.toLowerCase()
    if (!isCaseOnlyRename && await pathExists(nextPath)) {
      throw new Error('A file with this name already exists in the same folder.')
    }

    await rename(currentPath, nextPath)
    // Keep duplicate imports of the same source usable after either card
    // renames the underlying file.
    for (const [registeredKey, registeredPath] of importedAssetPaths) {
      if (registeredPath === currentPath) importedAssetPaths.set(registeredKey, nextPath)
    }
    importedPathKeys.delete(resolve(currentPath))
    importedPathKeys.set(resolve(nextPath), sourceKey)
    return { name: nextName }
  })
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1512,
    height: 982,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    title: 'Cueport',
    backgroundColor: '#262726',
    autoHideMenuBar: true,
    ...(!app.isPackaged && { icon: DEVELOPMENT_ICON }),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Match the conventional macOS title-bar inset. Keeping this near the
    // native default prevents the controls from drifting with custom chrome.
    ...(process.platform === 'darwin' && { trafficLightPosition: { x: 12, y: 12 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  })

  mainWindow = window
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.once('ready-to-show', () => {
    if (!window.isDestroyed() && !isQuitting) window.show()
  })

  // Cueport never needs renderer-initiated windows or navigation. Keeping those
  // paths closed makes later file and sharing features easier to reason about.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase()
    const isReloadShortcut = ((input.meta || input.control) && key === 'r') || key === 'f5'
    if (isReloadShortcut) event.preventDefault()
  })

  if (!app.isPackaged && DEVELOPMENT_RENDERER_URL) {
    void window.loadURL(DEVELOPMENT_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function showOrCreateMainWindow(): void {
  if (isQuitting) return

  const window = mainWindow
  if (!window || window.isDestroyed()) {
    createMainWindow()
    return
  }

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}

function scheduleMainWindowReopen(): void {
  if (reopenScheduled || isQuitting) return
  reopenScheduled = true

  // macOS dispatches `activate` synchronously from its reopen Apple event.
  // Defer Electron window work by one turn so wake/reopen events cannot race a
  // window being closed or restored inside AppKit's native callback.
  setImmediate(() => {
    reopenScheduled = false
    showOrCreateMainWindow()
  })
}

app.enableSandbox()

app.whenReady().then(() => {
  configureApplicationMenu()
  configureAssetProtocol()
  configureImportedAssetHandlers()
  configurePresentationHandlers()
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(DEVELOPMENT_ICON)
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => {
    return permission === 'fullscreen' && details.isMainFrame && Boolean(
      webContents && BrowserWindow.fromWebContents(webContents)
    )
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isTrustedMainFrame = 'isMainFrame' in details && details.isMainFrame && Boolean(
      BrowserWindow.fromWebContents(webContents)
    )
    callback(permission === 'fullscreen' && isTrustedMainFrame)
  })

  showOrCreateMainWindow()

  app.on('activate', scheduleMainWindowReopen)
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

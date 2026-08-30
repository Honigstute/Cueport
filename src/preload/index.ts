import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { CueportHost, DesktopPlatform } from '../shared/projects'

type DesktopHost = CueportHost<Parameters<typeof webUtils.getPathForFile>[0]>

// This intentionally tiny bridge is the renderer's only knowledge of Electron.
// The renderer receives only opaque source keys, never filesystem paths. This
// keeps rename capability limited to files explicitly imported in this session.
contextBridge.exposeInMainWorld('cueport', {
  runtime: 'desktop',
  // Electron desktop never targets Node's additional Android platform.
  platform: process.platform as DesktopPlatform,
  registerImportedFile: async (file) => {
    const filePath = webUtils.getPathForFile(file)
    return filePath ? ipcRenderer.invoke('asset:register', filePath) : null
  },
  renameImportedFile: (sourceKey, name) => ipcRenderer.invoke('asset:rename', sourceKey, name),
  listPresentations: () => ipcRenderer.invoke('presentation:list'),
  savePresentation: (request) => ipcRenderer.invoke('presentation:save', request),
  openPresentation: (id) => ipcRenderer.invoke('presentation:open', id),
  renamePresentation: (id, name) => ipcRenderer.invoke('presentation:rename', id, name),
  deletePresentation: (id) => ipcRenderer.invoke('presentation:delete', id),
  reorderPresentations: (ids) => ipcRenderer.invoke('presentation:reorder', ids),
  getPublishingStatus: () => ipcRenderer.invoke('publishing:status'),
  signInToPublishing: (request) => ipcRenderer.invoke('publishing:sign-in', request),
  signOutOfPublishing: () => ipcRenderer.invoke('publishing:sign-out'),
  publishPresentation: (id) => ipcRenderer.invoke('publishing:publish', id)
} satisfies DesktopHost)

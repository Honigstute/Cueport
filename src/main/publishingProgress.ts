const UPLOAD_START = 0.06
const UPLOAD_END = 0.94

/**
 * Reserves a small portion of the outline for draft creation and final commit,
 * while keeping most of it tied directly to bytes consumed by the upload.
 */
export function publishingProgressForUpload(uploadedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return UPLOAD_END
  const uploadedRatio = Math.max(0, Math.min(1, uploadedBytes / totalBytes))
  return UPLOAD_START + uploadedRatio * (UPLOAD_END - UPLOAD_START)
}

export const PUBLISHING_PREPARING_PROGRESS = 0.02
export const PUBLISHING_UPLOAD_READY_PROGRESS = UPLOAD_START
export const PUBLISHING_FINALIZING_PROGRESS = 0.97

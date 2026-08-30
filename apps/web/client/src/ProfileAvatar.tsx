import { useEffect, useState } from 'react'
import type { UserProfile } from './accountTypes'

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
}

export function ProfileAvatar({ profile, size = 34 }: { profile: Pick<UserProfile, 'displayName' | 'avatarUrl'>; size?: number }): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  useEffect(() => setFailedUrl(null), [profile.avatarUrl])
  const showImage = Boolean(profile.avatarUrl && profile.avatarUrl !== failedUrl)

  return (
    <span aria-hidden="true" className="profile-avatar" style={{ height: size, width: size }}>
      {showImage
        ? <img alt="" onError={() => setFailedUrl(profile.avatarUrl)} src={profile.avatarUrl ?? undefined} />
        : <span>{initials(profile.displayName)}</span>}
    </span>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import type { UserProfile } from './accountTypes'
import { ProfileAvatar } from './ProfileAvatar'

export function AccountMenu({ profile, onAccounts, onLogout, onPassword, onProfile }: {
  profile: UserProfile
  onAccounts?: () => void
  onLogout: () => void
  onPassword: () => void
  onProfile: () => void
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="account-menu-wrap" ref={rootRef}>
      <button aria-expanded={open} aria-label="Account menu" className="account-menu-trigger" onClick={() => setOpen((value) => !value)} type="button">
        <ProfileAvatar profile={profile} size={34} />
        <span><strong>{profile.displayName}</strong><small>{profile.title || profile.email}</small></span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="account-popover" role="menu">
          <button onClick={() => { setOpen(false); onProfile() }} role="menuitem" type="button"><Icon name="user" size={15} /><span>Your Profile</span></button>
          <button onClick={() => { setOpen(false); onPassword() }} role="menuitem" type="button"><Icon name="lock" size={15} /><span>Change Password</span></button>
          {onAccounts && <button onClick={() => { setOpen(false); onAccounts() }} role="menuitem" type="button"><Icon name="settings" size={15} /><span>Accounts</span></button>}
          <button onClick={() => { setOpen(false); onLogout() }} role="menuitem" type="button"><Icon name="arrow-left" size={15} /><span>Sign Out</span></button>
        </div>
      )}
    </div>
  )
}

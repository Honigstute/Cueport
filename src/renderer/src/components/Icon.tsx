import type { SVGProps } from 'react'

export type IconName =
  | 'add'
  | 'arrow-left'
  | 'arrow-right'
  | 'check'
  | 'chevron-down'
  | 'close'
  | 'comment'
  | 'camera'
  | 'edit'
  | 'eye'
  | 'eye-off'
  | 'fit-width'
  | 'home'
  | 'image'
  | 'layers'
  | 'more'
  | 'palette'
  | 'play'
  | 'remove'
  | 'send'
  | 'settings'
  | 'spark'
  | 'target'
  | 'upload'
  | 'user'
  | 'viewport'
  | 'window'
  | 'zoom'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...props }: IconProps): React.JSX.Element {
  const paths: Record<IconName, React.JSX.Element> = {
    add: <><path d="M12 5v14M5 12h14" /></>,
    'arrow-left': <><path d="m15 18-6-6 6-6" /></>,
    'arrow-right': <><path d="m9 18 6-6-6-6" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    camera: <><path d="M4 8.5h3l1.4-2h7.2l1.4 2h3v10H4Z" /><circle cx="12" cy="13.5" r="3.2" /></>,
    'chevron-down': <><path d="m7 10 5 5 5-5" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    comment: <><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8 9h8M8 12h5" /></>,
    edit: <><path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z" /><path d="m14.8 6.8 2.4 2.4" /></>,
    eye: <><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.75" /></>,
    'eye-off': <><path d="m3 3 18 18" /><path d="M10.6 6.1A10.4 10.4 0 0 1 12 6c6.1 0 9.5 6 9.5 6a17.4 17.4 0 0 1-2.1 2.8M6.2 6.2C3.8 8 2.5 12 2.5 12s3.4 6 9.5 6c1 0 2-.2 2.8-.5" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
    'fit-width': <><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M7 12h10m0 0-2.5-2.5M17 12l-2.5 2.5M7 12l2.5-2.5M7 12l2.5 2.5" /></>,
    home: <><path d="m3 11 9-7 9 7" /><path d="M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 20" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    palette: <><path d="M12 3a9 9 0 1 0 0 18h1.5a1.7 1.7 0 0 0 0-3.4H12a1.6 1.6 0 0 1 0-3.2h2.5A6.5 6.5 0 0 0 21 8.1C21 4.7 16.8 3 12 3Z" /><circle cx="7.5" cy="9" r=".8" fill="currentColor" stroke="none" /><circle cx="10.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="6.7" r=".8" fill="currentColor" stroke="none" /></>,
    play: <><path d="m9 6 9 6-9 6Z" /></>,
    remove: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" /></>,
    send: <><path d="m3 11 17-8-6.5 18-2.7-7.8L3 11Z" /><path d="m10.8 13.2 4.8-4.8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 8.97 19.35a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.65 8.94a1.7 1.7 0 0 0-.34-1.88L4.25 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10.05 3H10v-.02h4V3a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H21v4h-.04A1.7 1.7 0 0 0 19.4 15Z" /></>,
    spark: <><path d="m12 3 1.15 4.1L17 8.5l-3.85 1.4L12 14l-1.15-4.1L7 8.5l3.85-1.4L12 3Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></>,
    target: <><path d="M9 4H6a2 2 0 0 0-2 2v3M15 4h3a2 2 0 0 1 2 2v3M9 20H6a2 2 0 0 1-2-2v-3M15 20h3a2 2 0 0 0 2-2v-3" /><rect x="8" y="7" width="8" height="10" rx="1" /></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M5 14v5h14v-5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    viewport: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 5v14M16 5v14" /></>,
    window: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></>,
    zoom: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" /></>
  }

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}

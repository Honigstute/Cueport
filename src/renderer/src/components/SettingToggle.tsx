interface SettingToggleProps {
  checked: boolean
  description: string
  label: string
  onChange: (checked: boolean) => void
}

export function SettingToggle({ checked, description, label, onChange }: SettingToggleProps): React.JSX.Element {
  return (
    <button
      aria-checked={checked}
      className="canvas-start-toggle"
      data-active={checked}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className="canvas-option-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span aria-hidden="true" className="toggle-track">
        <span className="toggle-thumb" />
      </span>
    </button>
  )
}

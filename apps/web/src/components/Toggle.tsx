export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; shortcut?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className="btn w-full justify-start"
      onClick={() => props.onChange(!props.checked)}
    >
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${props.checked ? 'bg-[var(--accent)]' : 'bg-white/15'}`}
        aria-hidden="true"
      >
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${props.checked ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      {props.label}
      {props.shortcut && <span className="kbd ml-auto">{props.shortcut}</span>}
    </button>
  );
}

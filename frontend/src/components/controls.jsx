// Small building blocks shared by the Settings screens.

export function Section({ title, hint, children }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{title}</h2>
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">{children}</div>
      {hint && <p className="mt-2 px-1 text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
    </section>
  );
}

export function Row({ label, hint, children, stack = false }) {
  return (
    <div className={`border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-800 ${stack ? '' : 'flex items-center justify-between gap-4'}`}>
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Switch({ checked, onChange, label, testId }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-neutral-300 dark:bg-neutral-700'}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

export function Segmented({ value, options, onChange, testId }) {
  return (
    <div className="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value ? 'bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

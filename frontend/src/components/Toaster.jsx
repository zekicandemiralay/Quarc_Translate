import useToastStore from '../store/toastStore';

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`animate-fade-in rounded-full px-4 py-2 text-sm font-medium shadow-lg ${
            t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/** Shown instantly while a page loads: the shape of the page, gently pulsing. */
export default function Loading() {
  return (
    <div className="animate-fade-in space-y-3 pt-3" aria-busy="true" aria-label="Loading">
      <div className="mx-4 h-6 w-40 animate-pulse rounded bg-gray-200 sm:mx-0" />
      <div className="h-24 animate-pulse mx-3 rounded-2xl bg-surface shadow-lg shadow-black/20 sm:mx-0" />
      <div className="space-y-px mx-3 overflow-hidden rounded-2xl bg-gray-100 sm:mx-0">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 bg-surface px-4 py-3">
            <div className="h-9 w-9 animate-pulse rounded-full bg-gray-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-4 w-8 animate-pulse rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

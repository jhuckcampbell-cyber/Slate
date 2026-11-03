/** Static-shell fallback for per-user pages (Cache Components streams the real content in). */
export function PageSkeleton() {
  return (
    <main
      aria-busy="true"
      className="mx-auto w-full max-w-md flex-1 animate-pulse space-y-4 px-4 pt-8"
    >
      <div className="h-5 w-24 rounded bg-muted" />
      <div className="h-9 w-3/4 rounded bg-muted" />
      <div className="h-4 w-1/2 rounded bg-muted" />
      <div className="mt-8 h-32 rounded-2xl bg-muted" />
      <div className="h-24 rounded-2xl bg-muted" />
    </main>
  );
}

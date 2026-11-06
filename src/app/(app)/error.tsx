"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <h1 className="text-lg font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-gray-500">The page couldn&apos;t load. Your data is safe. Try again, and tell the league admin if it keeps happening{error.digest ? ` (code ${error.digest})` : ""}.</p>
      <button className="btn-primary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}

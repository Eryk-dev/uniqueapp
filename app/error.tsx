"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center space-y-4">
        <h2 className="text-xl font-semibold text-ink">Algo deu errado</h2>
        <p className="text-sm text-ink-muted">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-ink text-paper text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { FotoBlocoProblema } from '@/lib/types';

interface Props {
  fotos: FotoBlocoProblema[];
  onRetrySuccess: () => void;
}

export function BlocoFotosRetryCard({ fotos, onRetrySuccess }: Props) {
  const [retrying, setRetrying] = useState(false);

  async function retryAll() {
    setRetrying(true);
    try {
      const res = await fetch('/api/bloco/fotos/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto_ids: fotos.map((f) => f.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Retry falhou');

      const baixadas = data.results.filter(
        (r: { status: string }) => r.status === 'baixada'
      ).length;
      const erros = data.results.length - baixadas;
      if (erros === 0) {
        toast.success(`${baixadas} foto(s) baixadas com sucesso`);
      } else {
        toast.warning(`${baixadas} ok, ${erros} com erro`);
      }
      onRetrySuccess();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  if (fotos.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-amber-800 dark:text-amber-200">
            ⚠️ {fotos.length} foto(s) com problema
          </h3>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            Não será possível gerar a chapa até resolver.
          </p>
        </div>
        <button
          onClick={retryAll}
          disabled={retrying}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {retrying ? 'Tentando...' : 'Tentar novamente'}
        </button>
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        {fotos.map((f) => (
          <li key={f.id} className="flex items-start gap-2">
            <span className="mt-0.5 inline-block rounded-full bg-amber-200 px-1.5 text-xs text-amber-800">
              Foto {f.posicao}
            </span>
            <div className="flex-1">
              <div className="text-amber-900 dark:text-amber-100">
                Status: {f.status}
                {f.erro_detalhe ? ` — ${f.erro_detalhe}` : ''}
              </div>
              <a
                href={f.shopify_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-600 underline hover:text-amber-800"
              >
                URL original (Shopify)
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

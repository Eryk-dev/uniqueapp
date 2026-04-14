'use client';

import { useState } from 'react';

interface FreightGroup {
  forma_frete: string;
  id_forma_frete: number | null;
  id_transportador: number | null;
  nf_ids: number[];
}

interface ExpeditionPanelProps {
  loteId: string;
  groups: FreightGroup[];
  onExpeditionCreated: () => void;
}

export default function ExpeditionPanel({ loteId, groups, onExpeditionCreated }: ExpeditionPanelProps) {
  const [creating, setCreating] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { success: boolean; tinyId?: number; error?: string }>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function handleCreate(group: FreightGroup) {
    setCreating(group.forma_frete);
    try {
      const res = await fetch('/api/expedicoes/criar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lote_id: loteId,
          forma_frete: group.forma_frete,
          nf_ids: group.nf_ids,
          id_forma_frete: group.id_forma_frete,
          id_transportador: group.id_transportador,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResults((prev) => ({
          ...prev,
          [group.forma_frete]: { success: true, tinyId: data.tiny_expedicao_id },
        }));
        onExpeditionCreated();
      } else {
        setResults((prev) => ({
          ...prev,
          [group.forma_frete]: { success: false, error: data.error },
        }));
      }
    } catch {
      setResults((prev) => ({
        ...prev,
        [group.forma_frete]: { success: false, error: 'Erro de conexao' },
      }));
    } finally {
      setCreating(null);
    }
  }

  function toggleExpand(forma: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(forma)) next.delete(forma);
      else next.add(forma);
      return next;
    });
  }

  if (groups.length === 0) {
    return <p className="text-sm text-gray-400">Nenhum grupo de frete disponivel</p>;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const result = results[group.forma_frete];
        const isCreating = creating === group.forma_frete;
        const isExpanded = expanded.has(group.forma_frete);

        return (
          <div key={group.forma_frete} className="bg-white border rounded-lg">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleExpand(group.forma_frete)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <div>
                  <h4 className="font-medium text-sm">{group.forma_frete}</h4>
                  <p className="text-xs text-gray-500">{group.nf_ids.length} NFs</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {result?.success && (
                  <span className="text-xs text-green-600">
                    Tiny ID: {result.tinyId ?? 'OK'}
                  </span>
                )}
                {result && !result.success && (
                  <span className="text-xs text-red-600">{result.error}</span>
                )}
                <button
                  onClick={() => handleCreate(group)}
                  disabled={isCreating || result?.success === true}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreating ? 'Criando...' : result?.success ? 'Criada' : 'Criar Expedicao'}
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">NF IDs:</p>
                <div className="flex flex-wrap gap-1">
                  {group.nf_ids.map((nfId) => (
                    <span key={nfId} className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">
                      {nfId}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

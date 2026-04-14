'use client';

import { useState } from 'react';
import type { TarefaStatus } from '@/lib/types';

interface TaskData {
  id: string;
  titulo: string;
  status: TarefaStatus;
  notas: string | null;
  created_at: string;
  completed_at: string | null;
  lotes_producao?: {
    linha_produto: string;
    total_itens: number;
    itens_sucesso: number;
    itens_erro: number;
  } | null;
}

interface TaskCardProps {
  tarefa: TaskData;
  onUpdate: () => void;
}

const STATUS_CONFIG: Record<TarefaStatus, { label: string; color: string; next: TarefaStatus | null }> = {
  pendente: { label: 'Pendente', color: 'bg-yellow-100 text-yellow-700', next: 'em_andamento' },
  em_andamento: { label: 'Em Andamento', color: 'bg-blue-100 text-blue-700', next: 'concluido' },
  concluido: { label: 'Concluido', color: 'bg-green-100 text-green-700', next: null },
};

export default function TaskCard({ tarefa, onUpdate }: TaskCardProps) {
  const [notas, setNotas] = useState(tarefa.notas ?? '');
  const [saving, setSaving] = useState(false);
  const config = STATUS_CONFIG[tarefa.status];
  const lote = tarefa.lotes_producao;

  async function updateTask(update: { status?: TarefaStatus; notas?: string }) {
    setSaving(true);
    try {
      await fetch(`/api/tarefas/${tarefa.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      onUpdate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-medium text-sm">{tarefa.titulo}</h4>
          <p className="text-xs text-gray-400 mt-0.5">
            {new Date(tarefa.created_at).toLocaleString('pt-BR')}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.color}`}>
          {config.label}
        </span>
      </div>

      {lote && (
        <div className="flex gap-4 text-xs text-gray-500">
          <span>{lote.linha_produto}</span>
          <span>{lote.total_itens} itens</span>
          <span className="text-green-600">{lote.itens_sucesso} ok</span>
          {lote.itens_erro > 0 && <span className="text-red-600">{lote.itens_erro} erro</span>}
        </div>
      )}

      <div>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Notas..."
          rows={2}
          className="w-full px-2 py-1.5 border rounded text-sm resize-none"
        />
        {notas !== (tarefa.notas ?? '') && (
          <button
            onClick={() => updateTask({ notas })}
            disabled={saving}
            className="text-xs text-blue-600 hover:underline mt-1"
          >
            Salvar notas
          </button>
        )}
      </div>

      {config.next && (
        <button
          onClick={() => updateTask({ status: config.next! })}
          disabled={saving}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Salvando...' : `Mover para ${STATUS_CONFIG[config.next].label}`}
        </button>
      )}

      {tarefa.completed_at && (
        <p className="text-xs text-gray-400">
          Concluido em {new Date(tarefa.completed_at).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}

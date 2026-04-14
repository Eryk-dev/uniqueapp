'use client';

import type { Evento } from '@/lib/types';

const TIPO_ICONS: Record<string, { icon: string; color: string }> = {
  status_change: { icon: 'S', color: 'bg-blue-500' },
  file_generated: { icon: 'F', color: 'bg-green-500' },
  expedicao_criada: { icon: 'E', color: 'bg-purple-500' },
  erro: { icon: '!', color: 'bg-red-500' },
  api_call: { icon: 'A', color: 'bg-gray-500' },
};

interface OrderTimelineProps {
  eventos: Evento[];
  onRetry?: (eventoId: string) => void;
}

export default function OrderTimeline({ eventos, onRetry }: OrderTimelineProps) {
  if (eventos.length === 0) {
    return <p className="text-sm text-gray-400">Nenhum evento registrado</p>;
  }

  return (
    <div className="space-y-0">
      {eventos.map((evento, i) => {
        const config = TIPO_ICONS[evento.tipo] ?? TIPO_ICONS.api_call;
        const isLast = i === eventos.length - 1;
        const isError = evento.tipo === 'erro';

        return (
          <div key={evento.id} className="flex gap-3">
            {/* Timeline line + icon */}
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${config.color}`}
              >
                {config.icon}
              </div>
              {!isLast && <div className="w-px flex-1 bg-gray-200 my-1" />}
            </div>

            {/* Content */}
            <div className={`pb-4 flex-1 ${isLast ? '' : ''}`}>
              <p className="text-sm font-medium text-gray-800">{evento.descricao}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-400">
                  {new Date(evento.created_at).toLocaleString('pt-BR')}
                </span>
                <span className="text-xs text-gray-400">
                  {evento.ator}
                </span>
              </div>

              {isError && evento.dados && (
                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  <p>{(evento.dados as Record<string, string>).error ?? JSON.stringify(evento.dados)}</p>
                  {onRetry && (
                    <button
                      onClick={() => onRetry(evento.id)}
                      className="mt-1 text-red-600 underline hover:text-red-800"
                    >
                      Tentar novamente
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

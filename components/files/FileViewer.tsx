'use client';

import { useEffect, useState } from 'react';
import type { Arquivo } from '@/lib/types';

interface FileViewerProps {
  arquivo: Arquivo;
}

export default function FileViewer({ arquivo }: FileViewerProps) {
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUrl() {
      try {
        const res = await fetch(`/api/arquivos/${arquivo.id}/view`);
        if (res.ok) {
          const data = await res.json();
          setViewUrl(data.url);
        }
      } finally {
        setLoading(false);
      }
    }
    loadUrl();
  }, [arquivo.id]);

  if (loading) {
    return <div className="flex items-center justify-center h-48 bg-gray-50 rounded text-gray-400 text-sm">Carregando...</div>;
  }

  if (!viewUrl) {
    return <div className="flex items-center justify-center h-48 bg-gray-50 rounded text-gray-400 text-sm">Falha ao carregar</div>;
  }

  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-xs font-mono uppercase ${
            arquivo.tipo === 'svg' ? 'bg-blue-100 text-blue-700' :
            arquivo.tipo === 'png' ? 'bg-emerald-100 text-emerald-700' :
            'bg-red-100 text-red-700'
          }`}>
            {arquivo.tipo}
          </span>
          <span className="text-sm text-gray-600 truncate max-w-64">{arquivo.nome_arquivo}</span>
        </div>
        <a
          href={`/api/arquivos/${arquivo.id}/download`}
          className="text-xs text-blue-600 hover:underline"
        >
          Download
        </a>
      </div>

      <div className="p-2">
        {arquivo.tipo === 'svg' || arquivo.tipo === 'png' ? (
          <img
            src={viewUrl}
            alt={arquivo.nome_arquivo}
            className="max-w-full h-auto mx-auto"
          />
        ) : (
          <iframe
            src={viewUrl}
            className="w-full h-96 border-0"
            title={arquivo.nome_arquivo}
          />
        )}
      </div>

      {arquivo.tamanho_bytes && (
        <div className="px-3 py-1 border-t text-xs text-gray-400">
          {(arquivo.tamanho_bytes / 1024).toFixed(1)} KB
          {' · '}
          {new Date(arquivo.created_at).toLocaleString('pt-BR')}
        </div>
      )}
    </div>
  );
}

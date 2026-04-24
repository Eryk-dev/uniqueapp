'use client';

import { useState } from 'react';
import type { Arquivo } from '@/lib/types';
import FileViewer from './FileViewer';

interface BatchFileListProps {
  arquivos: Arquivo[];
}

export default function BatchFileList({ arquivos }: BatchFileListProps) {
  const [previewFile, setPreviewFile] = useState<Arquivo | null>(null);

  if (arquivos.length === 0) {
    return <p className="text-sm text-gray-400">Nenhum arquivo</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {arquivos.map((file) => (
          <div
            key={file.id}
            className="flex items-center justify-between px-3 py-2 bg-white border rounded hover:bg-gray-50"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-mono uppercase ${
                file.tipo === 'svg' ? 'bg-blue-100 text-blue-700' :
                file.tipo === 'png' ? 'bg-emerald-100 text-emerald-700' :
                'bg-red-100 text-red-700'
              }`}>
                {file.tipo}
              </span>
              <span className="text-sm truncate">{file.nome_arquivo}</span>
              {file.tamanho_bytes && (
                <span className="text-xs text-gray-400 shrink-0">
                  {(file.tamanho_bytes / 1024).toFixed(1)} KB
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setPreviewFile(previewFile?.id === file.id ? null : file)}
                className="text-xs text-gray-500 hover:text-blue-600"
              >
                {previewFile?.id === file.id ? 'Fechar' : 'Preview'}
              </button>
              <a
                href={`/api/arquivos/${file.id}/download`}
                className="text-xs text-blue-600 hover:underline"
              >
                Download
              </a>
            </div>
          </div>
        ))}
      </div>

      {previewFile && (
        <FileViewer arquivo={previewFile} />
      )}
    </div>
  );
}

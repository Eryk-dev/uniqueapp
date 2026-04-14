'use client';

import { useState, FormEvent } from 'react';

interface FileResult {
  tipo: string;
  url: string;
}

export default function UniqueBoxForm() {
  const [cliente, setCliente] = useState('');
  const [linha1, setLinha1] = useState('');
  const [linha2, setLinha2] = useState('');
  const [linha3, setLinha3] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ pedidoId: string; files: FileResult[] } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch('/api/avulso/uniquebox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente, linha1, linha2, linha3 }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Erro ao criar pedido');
        return;
      }

      setResult({ pedidoId: data.pedido_id, files: data.arquivos ?? [] });
      setCliente('');
      setLinha1('');
      setLinha2('');
      setLinha3('');
    } catch {
      setError('Erro de conexao');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Cliente</label>
        <input
          type="text"
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          className="w-full px-3 py-2 border rounded-md text-sm"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Linha 1</label>
        <input
          type="text"
          value={linha1}
          onChange={(e) => setLinha1(e.target.value.toUpperCase())}
          className="w-full px-3 py-2 border rounded-md text-sm font-mono"
          placeholder="EU TE"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Linha 2</label>
        <input
          type="text"
          value={linha2}
          onChange={(e) => setLinha2(e.target.value.toUpperCase())}
          className="w-full px-3 py-2 border rounded-md text-sm font-mono"
          placeholder="AMO"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Linha 3</label>
        <input
          type="text"
          value={linha3}
          onChange={(e) => setLinha3(e.target.value.toUpperCase())}
          className="w-full px-3 py-2 border rounded-md text-sm font-mono"
          placeholder="MARIA"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !cliente}
        className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Gerando...' : 'Gerar UniqueBox'}
      </button>

      {result && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-700 font-medium mb-2">
            Pedido criado: {result.pedidoId.slice(0, 8)}
          </p>
          {result.files.length > 0 ? (
            <div className="space-y-1">
              {result.files.map((file, i) => (
                <a
                  key={i}
                  href={file.url}
                  className="block text-sm text-blue-600 hover:underline"
                >
                  Download {file.tipo.toUpperCase()}
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Arquivos em processamento...</p>
          )}
        </div>
      )}
    </form>
  );
}

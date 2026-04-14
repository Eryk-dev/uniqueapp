'use client';

import { useState, FormEvent } from 'react';

interface FileResult {
  tipo: string;
  url: string;
}

const MOLDES = ['NM AV', 'NNA', 'TD', 'PD', 'NNA CP', 'NM AV CP'];
const FONTES = ['MALINDA', 'FORMA', 'TD', 'PD'];

export default function UniqueKidsForm() {
  const [cliente, setCliente] = useState('');
  const [nome, setNome] = useState('');
  const [molde, setMolde] = useState('NM AV');
  const [fonte, setFonte] = useState('MALINDA');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ pedidoId: string; files: FileResult[] } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch('/api/avulso/uniquekids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente, nome, molde, fonte }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Erro ao criar pedido');
        return;
      }

      setResult({ pedidoId: data.pedido_id, files: data.arquivos ?? [] });
      setCliente('');
      setNome('');
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
        <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value.toUpperCase())}
          className="w-full px-3 py-2 border rounded-md text-sm font-mono"
          placeholder="MARIA"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Molde</label>
          <select
            value={molde}
            onChange={(e) => setMolde(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm bg-white"
          >
            {MOLDES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fonte</label>
          <select
            value={fonte}
            onChange={(e) => setFonte(e.target.value)}
            className="w-full px-3 py-2 border rounded-md text-sm bg-white"
          >
            {FONTES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !cliente || !nome}
        className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Gerando...' : 'Gerar UniqueKids'}
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

'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Link2, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface TinyConnection {
  id: string;
  nome: string;
  client_id: string;
  ativo: boolean;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
}

export default function TinyConfigPage() {
  const searchParams = useSearchParams();
  const oauthSuccess = searchParams.get('oauth_success');
  const oauthError = searchParams.get('oauth_error');

  const [connection, setConnection] = useState<TinyConnection | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    fetchConnection();
  }, []);

  async function fetchConnection() {
    try {
      const res = await fetch('/api/tiny/connections');
      if (res.ok) {
        const data = await res.json();
        const active = data.find((c: TinyConnection) => c.ativo);
        if (active) {
          setConnection(active);
          setClientId(active.client_id || '');
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/tiny/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: connection?.id,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setConnection(data);
        setClientSecret('');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleConnect() {
    if (!connection?.id) return;
    setConnecting(true);
    window.location.href = `/api/tiny/oauth?connectionId=${connection.id}`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <a href="/admin/usuarios" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 mb-6">
        <ArrowLeft className="w-4 h-4" />
        Admin
      </a>

      <h1 className="text-2xl font-semibold mb-1">Conexao Tiny ERP</h1>
      <p className="text-sm text-zinc-400 mb-8">
        Configure as credenciais OAuth2 para conectar ao Tiny ERP v3.
      </p>

      {/* OAuth status messages */}
      {oauthSuccess && (
        <div className="flex items-center gap-2 p-3 mb-6 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          Conectado com sucesso ao Tiny ERP!
        </div>
      )}
      {oauthError && (
        <div className="flex items-center gap-2 p-3 mb-6 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <XCircle className="w-4 h-4 flex-shrink-0" />
          Erro OAuth: {oauthError}
        </div>
      )}

      {/* Connection status */}
      {connection && (
        <div className="flex items-center gap-3 p-4 mb-6 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
          <div className={`w-2.5 h-2.5 rounded-full ${
            connection.ultimo_teste_ok ? 'bg-emerald-500' : 'bg-zinc-500'
          }`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{connection.nome}</p>
            <p className="text-xs text-zinc-500">
              {connection.ultimo_teste_ok
                ? `Conectado — ultimo teste em ${new Date(connection.ultimo_teste_em!).toLocaleString('pt-BR')}`
                : 'Nao conectado — complete o fluxo OAuth abaixo'
              }
            </p>
          </div>
        </div>
      )}

      {/* Credentials form */}
      <div className="space-y-4 p-5 rounded-lg bg-zinc-900 border border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-300">Credenciais OAuth2</h2>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Seu client_id do Tiny"
            className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Client Secret</label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={connection ? '••••••••  (salvo)' : 'Seu client_secret do Tiny'}
            className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !clientId || !clientSecret}
          className="w-full py-2 rounded-md bg-zinc-700 hover:bg-zinc-600 text-sm font-medium text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Salvando...' : connection ? 'Atualizar credenciais' : 'Salvar credenciais'}
        </button>
      </div>

      {/* Connect button */}
      {connection && (
        <div className="mt-6 p-5 rounded-lg bg-zinc-900 border border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-300 mb-3">Autorizar acesso</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Apos salvar as credenciais, clique para autorizar o acesso ao Tiny ERP.
            Voce sera redirecionado para o Tiny e depois de volta aqui.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white disabled:opacity-50 transition-colors"
          >
            <Link2 className="w-4 h-4" />
            {connecting ? 'Redirecionando...' : 'Conectar ao Tiny ERP'}
          </button>
        </div>
      )}
    </div>
  );
}

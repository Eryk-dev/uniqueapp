/**
 * Tiny ERP API v3 client.
 * Uses OAuth2 Bearer tokens via getValidToken().
 *
 * Base URL: https://api.tiny.com.br/public-api/v3
 */

import { getValidToken } from './oauth';
import { tinyQueue } from './queue';

const TINY_BASE = 'https://api.tiny.com.br/public-api/v3';
const MAX_RETRIES = 3;

// ─── Core fetch (rate-limited via tinyQueue) ────────────────────────────────

async function tinyFetch<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {}
): Promise<T> {
  return tinyQueue.execute(async () => {
    const token = await getValidToken();
    const { method = 'GET', body } = opts;
    const url = `${TINY_BASE}${path}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Tiny API ${method} ${path} → 429 after ${MAX_RETRIES} retries`);
        }
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000)
          : Math.min(2000 * 2 ** attempt, 15_000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Tiny API ${method} ${path} → ${res.status}: ${text}`);
      }

      if (res.status === 204) return undefined as unknown as T;

      const text = await res.text();
      if (!text) return undefined as unknown as T;

      return JSON.parse(text) as T;
    }

    throw new Error(`Tiny API ${method} ${path} → exhausted retries`);
  });
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TinyPedidoItem {
  produto: {
    id: number;
    sku: string;
    descricao: string;
  };
  quantidade: number;
  valorUnitario: number;
  infoAdicional?: string;
}

export interface TinyPedidoRaw {
  id: number;
  numeroPedido: number;
  data: string;
  cliente: {
    id: number;
    nome: string;
    cpfCnpj?: string;
  };
  ecommerce?: {
    id: number;
    nome: string;
    numeroPedidoEcommerce: string;
  };
  transportador?: {
    id?: number;
    formaEnvio?: { id: number; nome: string };
    formaFrete?: { id: number; nome: string };
  };
  itens: TinyPedidoItem[];
  valorFrete?: number;
  valorDesconto?: number;
  observacoes?: string;
  observacoesInternas?: string;
  enderecoEntrega?: {
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cep: string;
    municipio: string;
    uf: string;
    pais?: string;
    nomeDestinatario?: string;
    cpfCnpj?: string;
    tipoPessoa?: string;
    telefone?: string;
    inscricaoEstadual?: string;
  };
}

export interface TinyNotaFiscalRaw {
  id: number;
  numero?: string | null;
  serie?: string | null;
  chaveAcesso?: string | null;
  dataEmissao?: string | null;
  valor?: number | null;
  situacao?: number | null;
  origem?: {
    id: string | null;
    tipo: string | null;
  };
}

export interface TinyNotaFiscalGerada {
  id: number;
  numero: number;
  serie: number;
}

export interface TinyCriarExpedicaoResponse {
  id: number;
  numero?: number;
}

// ─── Pedidos ────────────────────────────────────────────────────────────────

export async function fetchOrder(tinyPedidoId: number): Promise<TinyPedidoRaw> {
  return tinyFetch<TinyPedidoRaw>(`/pedidos/${tinyPedidoId}`);
}

export async function createOrder(orderData: {
  idContato: number;
  data: string;
  itens: Array<{
    produto: { id?: number; descricao?: string };
    quantidade: number;
    valorUnitario: number;
  }>;
  valorFrete?: number;
  valorDesconto?: number;
  observacoesInternas?: string;
  enderecoEntrega?: Record<string, string>;
  transportador?: {
    id?: number;
    formaEnvio?: { id: number };
    formaFrete?: { id: number };
  };
}): Promise<{ id: number; numeroPedido: number }> {
  return tinyFetch<{ id: number; numeroPedido: number }>('/pedidos', {
    method: 'POST',
    body: orderData,
  });
}

// ─── Notas Fiscais ──────────────────────────────────────────────────────────

export async function fetchNF(tinyNfId: number): Promise<TinyNotaFiscalRaw> {
  return tinyFetch<TinyNotaFiscalRaw>(`/notas/${tinyNfId}`);
}

export async function generateNF(
  tinyPedidoId: number,
  modelo: number = 55
): Promise<TinyNotaFiscalGerada> {
  return tinyFetch<TinyNotaFiscalGerada>(
    `/pedidos/${tinyPedidoId}/gerar-nota-fiscal`,
    { method: 'POST', body: { modelo } }
  );
}

// ─── Marcadores ─────────────────────────────────────────────────────────────

export async function setMarkers(
  tinyPedidoId: number,
  marcadores: string[]
): Promise<void> {
  const body = marcadores.map((m) => ({ descricao: m }));
  await tinyFetch<void>(`/pedidos/${tinyPedidoId}/marcadores`, {
    method: 'POST',
    body,
  });
}

export async function setNFMarkers(
  tinyNfId: number,
  marcadores: string[]
): Promise<void> {
  const body = marcadores.map((m) => ({ descricao: m }));
  await tinyFetch<void>(`/notas/${tinyNfId}/marcadores`, {
    method: 'POST',
    body,
  });
}

// ─── Expedicao ──────────────────────────────────────────────────────────────

export async function createExpedition(data: {
  idsNotasFiscais: number[];
  logistica?: { formaFrete: { id: number } };
}): Promise<TinyCriarExpedicaoResponse> {
  return tinyFetch<TinyCriarExpedicaoResponse>('/expedicao', {
    method: 'POST',
    body: data,
  });
}

export interface TinyExpedicaoItem {
  id: number;
  tipoObjeto: string;
  idObjeto: number;
  situacao: string;
  venda?: { id: number; numero?: number };
}

export interface TinyExpedicaoDetails {
  id: number;
  identificacao: string;
  data: string;
  formaEnvio?: { id: number; nome: string };
  expedicoes?: TinyExpedicaoItem[];
}

export async function fetchExpedition(idAgrupamento: number): Promise<TinyExpedicaoDetails> {
  return tinyFetch<TinyExpedicaoDetails>(`/expedicao/${idAgrupamento}`);
}

export async function completeExpedition(idAgrupamento: number): Promise<void> {
  await tinyFetch<void>(`/expedicao/${idAgrupamento}/concluir`, {
    method: 'POST',
  });
}

// ─── Expedicao Labels ──────────────────────────────────────────────────────

export async function fetchExpeditionItemLabels(
  idAgrupamento: number,
  idExpedicao: number
): Promise<{ urls: string[] }> {
  return tinyFetch<{ urls: string[] }>(
    `/expedicao/${idAgrupamento}/expedicao/${idExpedicao}/etiquetas`
  );
}

export async function fetchAllAgrupamentoLabels(
  idAgrupamento: number
): Promise<{ urls: string[] }> {
  const agrupamento = await fetchExpedition(idAgrupamento);
  const expedicoes = agrupamento.expedicoes ?? [];

  if (expedicoes.length === 0) {
    return { urls: [] };
  }

  const allUrls: string[] = [];
  for (const exp of expedicoes) {
    try {
      const result = await fetchExpeditionItemLabels(idAgrupamento, exp.id);
      if (result.urls?.length) {
        allUrls.push(...result.urls);
      }
    } catch {
      // Skip expedições that fail (e.g. not yet concluded)
    }
  }

  return { urls: allUrls };
}

// ─── Info ───────────────────────────────────────────────────────────────────

export async function testConnection(token: string): Promise<{ ok: boolean; nome?: string; erro?: string }> {
  try {
    const res = await fetch(`${TINY_BASE}/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return { ok: true, nome: data.fantasia ?? data.razaoSocial ?? 'Conectado' };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : 'Erro desconhecido' };
  }
}


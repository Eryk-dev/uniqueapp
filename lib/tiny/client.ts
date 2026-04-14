import type { LinhaProduto } from '@/lib/types';

const RATE_LIMIT_MS = 2500; // 2.5s between calls

interface TinyApiResponse<T = unknown> {
  retorno: {
    status: string;
    status_processamento: number;
    registros?: T;
  };
}

let lastCallAt = 0;

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastCallAt;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastCallAt = Date.now();
}

function getConfig() {
  const baseUrl = process.env.TINY_ERP_BASE_URL;
  const token = process.env.TINY_ERP_ACCESS_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('Missing TINY_ERP_BASE_URL or TINY_ERP_ACCESS_TOKEN');
  }
  return { baseUrl, token };
}

async function tinyRequest<T = unknown>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<TinyApiResponse<T>> {
  await rateLimit();
  const { baseUrl, token } = getConfig();

  const searchParams = new URLSearchParams({ token, formato: 'json', ...params });
  const res = await fetch(`${baseUrl}/${endpoint}?${searchParams}`);

  if (!res.ok) {
    throw new Error(`Tiny API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function tinyPost<T = unknown>(
  endpoint: string,
  data: Record<string, unknown>
): Promise<TinyApiResponse<T>> {
  await rateLimit();
  const { baseUrl, token } = getConfig();

  const formData = new URLSearchParams();
  formData.set('token', token);
  formData.set('formato', 'json');
  formData.set('pedido', JSON.stringify(data));

  const res = await fetch(`${baseUrl}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });

  if (!res.ok) {
    throw new Error(`Tiny API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// ============================================================
// Public API
// ============================================================

export async function fetchOrder(tinyPedidoId: number) {
  return tinyRequest(`pedido.obter.php`, { id: String(tinyPedidoId) });
}

export async function createOrder(orderData: Record<string, unknown>) {
  return tinyPost('pedido.incluir.php', orderData);
}

export async function generateNF(tinyPedidoId: number) {
  return tinyRequest('gerar.nota.fiscal.pedido.php', { id: String(tinyPedidoId) });
}

export async function fetchNF(tinyNfId: number) {
  return tinyRequest('nota.fiscal.obter.php', { id: String(tinyNfId) });
}

export async function fetchNFByPedido(tinyPedidoId: number) {
  return tinyRequest('notas.fiscais.pesquisa.php', {
    idOrigem: String(tinyPedidoId),
  });
}

export async function setMarker(
  entity: 'pedido' | 'nota.fiscal',
  entityId: number,
  markerId: number
) {
  return tinyRequest(`${entity}.alterar.marcador.php`, {
    id: String(entityId),
    idMarcador: String(markerId),
  });
}

export async function createExpedition(data: {
  idsNotasFiscais: number[];
  logistica: { formaFrete: { id: number } };
}) {
  await rateLimit();
  const { baseUrl, token } = getConfig();

  const formData = new URLSearchParams();
  formData.set('token', token);
  formData.set('formato', 'json');
  formData.set('expedicao', JSON.stringify(data));

  const res = await fetch(`${baseUrl}/expedicao.incluir.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
  });

  if (!res.ok) {
    throw new Error(`Tiny API error: ${res.status}`);
  }

  return res.json();
}

export function getFlaskEndpoint(linhaProduto: LinhaProduto): string {
  return linhaProduto === 'uniquebox' ? '/gerar-chapas-batch' : '/gerar-moldes-batch';
}

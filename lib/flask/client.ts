interface FlaskBatchResponse {
  success: boolean;
  lote_id: string;
  arquivos: Array<{ tipo: string; storage_path: string }>;
  itens_sucesso: number;
  itens_erro: number;
  expedition_data: Record<string, { nf_ids: number[] }>;
}

function getConfig() {
  const url = process.env.FLASK_API_URL;
  const key = process.env.FLASK_INTERNAL_API_KEY;
  if (!url || !key) {
    throw new Error('Missing FLASK_API_URL or FLASK_INTERNAL_API_KEY');
  }
  return { url, key };
}

export async function gerarChapasBatch(loteId: string): Promise<FlaskBatchResponse> {
  const { url, key } = getConfig();

  const res = await fetch(`${url}/gerar-chapas-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
    },
    body: JSON.stringify({
      lote_id: loteId,
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Flask API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function gerarMoldesBatch(loteId: string): Promise<FlaskBatchResponse> {
  const { url, key } = getConfig();

  const res = await fetch(`${url}/gerar-moldes-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
    },
    body: JSON.stringify({
      lote_id: loteId,
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Flask API error ${res.status}: ${text}`);
  }

  return res.json();
}

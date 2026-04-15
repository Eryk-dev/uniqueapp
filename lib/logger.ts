import { createServerClient } from '@/lib/supabase/server';

// ── Webhook Logging ──

interface WebhookLogInput {
  source: string;
  endpoint: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  query_params?: Record<string, string>;
  pedido_id?: string;
  tiny_pedido_id?: number;
  dedup_key?: string;
}

interface WebhookLogHandle {
  id: string | null;
  finish: (params: {
    status: 'sucesso' | 'erro' | 'ignorado';
    status_code: number;
    response_body?: unknown;
    error_message?: string;
    pedido_id?: string;
  }) => Promise<void>;
}

export async function logWebhook(input: WebhookLogInput): Promise<WebhookLogHandle> {
  const start = Date.now();
  const supabase = createServerClient();

  const { data } = await supabase
    .from('webhook_logs')
    .insert({
      source: input.source,
      endpoint: input.endpoint,
      method: input.method ?? 'POST',
      headers: input.headers ?? {},
      body: input.body ?? {},
      query_params: input.query_params ?? {},
      pedido_id: input.pedido_id,
      tiny_pedido_id: input.tiny_pedido_id,
      dedup_key: input.dedup_key,
      status: 'recebido',
    })
    .select('id')
    .single();

  const logId = data?.id ?? null;

  return {
    id: logId,
    finish: async (params) => {
      if (!logId) return;
      await supabase
        .from('webhook_logs')
        .update({
          status: params.status,
          status_code: params.status_code,
          response_body: params.response_body ?? null,
          processing_ms: Date.now() - start,
          error_message: params.error_message ?? null,
          pedido_id: params.pedido_id,
        })
        .eq('id', logId);
    },
  };
}

// ── Error Logging ──

type ErrorCategory =
  | 'validation'
  | 'database'
  | 'external_api'
  | 'auth'
  | 'config'
  | 'business_logic'
  | 'infrastructure'
  | 'unknown';

type ErrorSeverity = 'warning' | 'error' | 'critical';

interface ErrorLogInput {
  source: string;
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  message: string;
  error?: unknown;
  pedido_id?: string;
  tiny_pedido_id?: number;
  webhook_log_id?: string | null;
  correlation_id?: string;
  request_path?: string;
  request_method?: string;
  metadata?: Record<string, unknown>;
}

export async function logError(input: ErrorLogInput): Promise<void> {
  const supabase = createServerClient();

  const stackTrace =
    input.error instanceof Error ? input.error.stack : undefined;
  const errorCode =
    input.error instanceof Error ? input.error.name : undefined;

  await supabase.from('erros').insert({
    source: input.source,
    category: input.category ?? 'unknown',
    severity: input.severity ?? 'error',
    message: input.message,
    stack_trace: stackTrace,
    error_code: errorCode,
    pedido_id: input.pedido_id,
    tiny_pedido_id: input.tiny_pedido_id,
    webhook_log_id: input.webhook_log_id,
    correlation_id: input.correlation_id,
    request_path: input.request_path,
    request_method: input.request_method,
    metadata: input.metadata ?? {},
  });
}

// ── Helpers ──

/** Extract safe headers (strips authorization/cookie) */
export function safeHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const skip = new Set(['authorization', 'cookie', 'set-cookie']);
  request.headers.forEach((value, key) => {
    if (!skip.has(key.toLowerCase())) {
      headers[key] = value;
    }
  });
  return headers;
}

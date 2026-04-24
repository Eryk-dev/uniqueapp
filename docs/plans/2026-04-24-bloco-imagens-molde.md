# Bloco Imagens no Molde — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar automaticamente a chapa SVG (+ PDF de conferência) de blocos UniqueBox para lotes de produção, inserindo as fotos do cliente nos 30 slots do molde `Blocos UniqueBox.svg`, com as URLs buscadas direto no Shopify Admin API pra evitar truncamento de 255 chars do Tiny.

**Architecture:** Duas camadas novas — (1) **Ingestão** (webhook Tiny → Shopify GraphQL → download → Supabase Storage → nova tabela `fotos_bloco`); (2) **Geração** (novo `lib/generation/bloco.ts` com parser do SVG template e packing algorithm; `processUniqueBoxBatch` estendido pra bifurcar box/bloco). Gate na geração impede produção com foto em erro. Retry UI no `/pedidos/[id]`.

**Tech Stack:** Next.js 14 App Router, TypeScript, `@supabase/supabase-js`, `@xmldom/xmldom` (já no projeto), `pdfkit` (já no projeto), Shopify GraphQL Admin API (2024-10), `tsx` (novo, só dev). Sem framework de teste — diagnostic scripts com `node:assert`.

**Spec:** `platform/docs/specs/2026-04-24-bloco-imagens-molde-design.md`

---

## File Structure

### Novos arquivos

```
platform/
├── supabase/migrations/008_fotos_bloco.sql           (schema + bucket + policies)
├── lib/
│   ├── shopify/
│   │   ├── types.ts                                   (interfaces da resposta Shopify)
│   │   ├── client.ts                                  (fetch GraphQL com retry + auth)
│   │   └── orders.ts                                  (fetchPhotosFromOrder)
│   ├── storage/
│   │   └── photos.ts                                  (download+upload, metadata)
│   └── generation/
│       ├── bloco.ts                                   (parser + packing + render SVG)
│       └── bloco-pdf.ts                               (PDF com thumbnail + slot map)
├── app/api/bloco/fotos/retry/route.ts                 (POST endpoint)
└── scripts/
    ├── test-shopify-connection.ts                     (diagnóstico pré-deploy)
    ├── test-bloco-template.ts                         (gera SVG de teste visual)
    ├── test-bloco-parser.ts                           (assertion test do parser)
    ├── test-bloco-packing.ts                          (assertion test do packing)
    └── backfill-bloco-photos.ts                       (one-shot pós-deploy)
```

### Arquivos modificados

```
platform/
├── package.json                                       (+ tsx devDep, + scripts)
├── lib/types/index.ts                                 (+ FotoBloco types)
├── lib/generation/config.ts                           (+ BLOCO_CONFIG)
├── lib/generation/index.ts                            (+ export bloco)
├── lib/tiny/enrichment.ts                             (persist sku, trigger bloco pipeline)
├── lib/generation/batch-processor.ts                  (bifurca box/bloco em processUniqueBoxBatch)
├── app/api/producao/gerar/route.ts                    (+ gate de fotos)
└── app/(dashboard)/pedidos/[id]/page.tsx              (+ card retry fotos)
```

---

## Convenções

- **Branch:** `feat/bloco-imagens-molde`
- **Commits:** padrão do projeto (`feat:`, `fix:`, `chore:`, `docs:` — minúsculas, sem acentos no body)
- **Schema:** sempre `unique_app` (o client já é criado com `db: { schema: 'unique_app' }`)
- **TypeScript:** sempre tipado estritamente; sem `any` exceto quando casting do Supabase resultset (já é padrão no codebase)
- **Env vars novas:** `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_SHOP_DOMAIN` (valor: `uniqueboxbrasil.myshopify.com`)
- **Verificação:** cada task termina com um `commit` step. Scripts de assertion rodam com `npx tsx scripts/<nome>.ts` e devem imprimir `OK` ou lançar.

---

### Task 1: Database migration — schema + bucket

**Files:**
- Create: `supabase/migrations/008_fotos_bloco.sql`

- [ ] **Step 1: Criar o arquivo da migration**

```sql
-- ============================================================
-- Migration 008: fotos_bloco table + colunas sku/tem_fotos_bloco em itens_producao + bucket bloco-fotos
-- ============================================================

SET search_path TO unique_app, public;

-- 1. Novas colunas em itens_producao
ALTER TABLE unique_app.itens_producao
  ADD COLUMN IF NOT EXISTS tem_fotos_bloco boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sku text;

CREATE INDEX IF NOT EXISTS itens_producao_sku_idx ON unique_app.itens_producao(sku) WHERE sku IS NOT NULL;

-- 2. Tabela fotos_bloco
CREATE TABLE IF NOT EXISTS unique_app.fotos_bloco (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid NOT NULL REFERENCES unique_app.itens_producao(id) ON DELETE CASCADE,
  posicao         smallint NOT NULL,
  shopify_url     text NOT NULL,
  storage_path    text,
  largura_px      int,
  altura_px       int,
  tamanho_bytes   int,
  content_type    text,
  status          text NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'baixada', 'erro')),
  erro_detalhe    text,
  baixada_em      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, posicao)
);

CREATE INDEX IF NOT EXISTS fotos_bloco_item_id_idx ON unique_app.fotos_bloco(item_id);
CREATE INDEX IF NOT EXISTS fotos_bloco_status_erro_idx
  ON unique_app.fotos_bloco(status) WHERE status = 'erro';

-- Trigger pra updated_at (padrão idêntico aos outros updated_at do schema)
CREATE OR REPLACE FUNCTION unique_app.fotos_bloco_updated_at_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fotos_bloco_updated_at ON unique_app.fotos_bloco;
CREATE TRIGGER fotos_bloco_updated_at
  BEFORE UPDATE ON unique_app.fotos_bloco
  FOR EACH ROW
  EXECUTE FUNCTION unique_app.fotos_bloco_updated_at_trigger();

-- 3. Bucket bloco-fotos (public read — URL estável embutida em <image> do SVG)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bloco-fotos', 'bloco-fotos', true)
ON CONFLICT (id) DO NOTHING;

-- Sem policies customizadas; service role bypassa RLS (padrão do projeto,
-- mesmo modelo do migration 003_storage_buckets.sql)
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Duas formas válidas:
- **Via Supabase MCP** (se disponível no ambiente): `mcp__supabase__apply_migration` com o SQL acima.
- **Via CLI Supabase**: `supabase db push` (rodar da raiz do `platform/`).

Output esperado: `Migration applied successfully` ou equivalente.

- [ ] **Step 3: Verificar que schema mudou**

Via SQL no Supabase SQL editor ou MCP:

```sql
-- 1. Colunas novas em itens_producao
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='unique_app' AND table_name='itens_producao'
  AND column_name IN ('sku','tem_fotos_bloco');
-- Esperado: 2 linhas

-- 2. Tabela fotos_bloco existe
SELECT COUNT(*) FROM unique_app.fotos_bloco;
-- Esperado: 0

-- 3. Bucket existe
SELECT id, public FROM storage.buckets WHERE id='bloco-fotos';
-- Esperado: ('bloco-fotos', true)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/008_fotos_bloco.sql
git commit -m "chore: add migration 008 for fotos_bloco table and bucket"
```

---

### Task 2: Dev tooling — tsx + npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalar tsx como devDep**

```bash
cd platform
npm install --save-dev tsx
```

- [ ] **Step 2: Adicionar scripts ao package.json**

Adicionar dentro de `"scripts"`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test:shopify": "tsx scripts/test-shopify-connection.ts",
    "test:bloco-parser": "tsx scripts/test-bloco-parser.ts",
    "test:bloco-packing": "tsx scripts/test-bloco-packing.ts",
    "test:bloco-template": "tsx scripts/test-bloco-template.ts",
    "backfill:bloco-photos": "tsx scripts/backfill-bloco-photos.ts"
  }
}
```

- [ ] **Step 3: Verificar tsx roda**

```bash
echo "console.log('ok')" > /tmp/smoke.ts
npx tsx /tmp/smoke.ts
# Esperado: ok
rm /tmp/smoke.ts
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add tsx devDep and bloco-related npm scripts"
```

---

### Task 3: Shopify types

**Files:**
- Create: `lib/shopify/types.ts`

- [ ] **Step 1: Criar tipos**

```typescript
// lib/shopify/types.ts

export interface ShopifyCustomAttribute {
  key: string;
  value: string;
}

export interface ShopifyLineItem {
  id: string;               // GID: gid://shopify/LineItem/1234
  sku: string | null;
  quantity: number;
  customAttributes: ShopifyCustomAttribute[];
  index?: number;           // populado por nós (não vem do Shopify) pra manter ordem original
}

export interface ShopifyOrder {
  id: string;               // GID: gid://shopify/Order/1234
  name: string;             // #1001
  lineItems: ShopifyLineItem[];
}

export interface BlocoPhoto {
  lineItemId: string;       // GID
  sku: string | null;
  lineItemIndex: number;    // posição na lista de line_items do pedido (0-based)
  posicao: number;          // N em "Foto N:"
  url: string;              // CDN URL original do Shopify
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: 'auth' | 'not_found' | 'rate_limit' | 'server_error' | 'unknown'
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
cd platform
npx tsc --noEmit
# Esperado: sem erros
```

- [ ] **Step 3: Commit**

```bash
git add lib/shopify/types.ts
git commit -m "feat: add shopify types for orders and bloco photos"
```

---

### Task 4: Shopify GraphQL client

**Files:**
- Create: `lib/shopify/client.ts`

- [ ] **Step 1: Criar o client**

```typescript
// lib/shopify/client.ts
import { ShopifyApiError } from './types';

const API_VERSION = '2024-10';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getShopifyConfig(): { domain: string; token: string } {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain) throw new Error('Missing SHOPIFY_SHOP_DOMAIN env var');
  if (!token) throw new Error('Missing SHOPIFY_ADMIN_TOKEN env var');

  return { domain, token };
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

/**
 * Executa GraphQL query no Shopify Admin API.
 * Retry 3x com backoff exponencial para 5xx/429.
 * Lança ShopifyApiError com code apropriado em falhas permanentes.
 */
export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { domain, token } = getShopifyConfig();
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
      });

      // Permanent failures — no retry
      if (res.status === 401 || res.status === 403) {
        throw new ShopifyApiError(
          `Shopify auth failed (${res.status})`,
          res.status,
          'auth'
        );
      }
      if (res.status === 404) {
        throw new ShopifyApiError(
          `Shopify endpoint or resource not found`,
          res.status,
          'not_found'
        );
      }

      // Retryable failures
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : BASE_BACKOFF_MS * Math.pow(2, attempt);

        if (attempt < MAX_RETRIES) {
          await sleep(waitMs);
          continue;
        }

        throw new ShopifyApiError(
          `Shopify API failed after ${MAX_RETRIES} retries (${res.status})`,
          res.status,
          res.status === 429 ? 'rate_limit' : 'server_error'
        );
      }

      // Other 4xx — permanent
      if (!res.ok) {
        throw new ShopifyApiError(
          `Shopify API error (${res.status}): ${await res.text()}`,
          res.status,
          'unknown'
        );
      }

      const payload = (await res.json()) as GraphQLResponse<T>;

      if (payload.errors && payload.errors.length > 0) {
        throw new ShopifyApiError(
          `GraphQL errors: ${payload.errors.map((e) => e.message).join('; ')}`,
          200,
          'unknown'
        );
      }

      if (!payload.data) {
        throw new ShopifyApiError('GraphQL response missing data', 200, 'unknown');
      }

      return payload.data;
    } catch (err) {
      if (err instanceof ShopifyApiError && err.code !== 'rate_limit' && err.code !== 'server_error') {
        throw err; // permanent — stop retrying
      }
      lastError = err as Error;

      if (attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
      }
    }
  }

  throw lastError ?? new Error('Shopify request failed');
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
npx tsc --noEmit
# Esperado: sem erros
```

- [ ] **Step 3: Commit**

```bash
git add lib/shopify/client.ts
git commit -m "feat: add shopify graphql client with retry"
```

---

### Task 5: Shopify orders — fetchPhotosFromOrder

**Files:**
- Create: `lib/shopify/orders.ts`

- [ ] **Step 1: Criar a função**

```typescript
// lib/shopify/orders.ts
import { shopifyGraphQL } from './client';
import { ShopifyApiError, type ShopifyOrder, type BlocoPhoto } from './types';

const ORDER_QUERY = `
  query GetOrderForBloco($id: ID!) {
    order(id: $id) {
      id
      name
      lineItems(first: 50) {
        edges {
          node {
            id
            sku
            quantity
            customAttributes {
              key
              value
            }
          }
        }
      }
    }
  }
`;

interface GraphQLOrderResponse {
  order: {
    id: string;
    name: string;
    lineItems: {
      edges: Array<{
        node: {
          id: string;
          sku: string | null;
          quantity: number;
          customAttributes: Array<{ key: string; value: string }>;
        };
      }>;
    };
  } | null;
}

/**
 * Converte um Shopify numeric order ID (ex: "6794997629172") para GID.
 */
function toOrderGid(numericId: string | number): string {
  return `gid://shopify/Order/${numericId}`;
}

/**
 * Extrai pares [posicao, url] de customAttributes olhando por chaves tipo "Foto 1", "Foto 2".
 * Ignora entries cuja key não bate com o pattern (ex: "Observação", "Nome").
 * Ignora quando o valor não parece URL válida.
 */
function parsePhotosFromCustomAttributes(
  attrs: Array<{ key: string; value: string }>
): Array<{ posicao: number; url: string }> {
  const pattern = /^Foto\s*(\d+)\s*:?\s*$/i;
  const photos: Array<{ posicao: number; url: string }> = [];

  for (const attr of attrs) {
    const match = attr.key.match(pattern);
    if (!match) continue;

    const posicao = parseInt(match[1]!, 10);
    if (!Number.isFinite(posicao) || posicao < 1) continue;

    const url = attr.value.trim();
    if (!/^https?:\/\//i.test(url)) continue;

    photos.push({ posicao, url });
  }

  // Sort determinístico por posição
  return photos.sort((a, b) => a.posicao - b.posicao);
}

/**
 * Busca fotos de bloco de um pedido Shopify.
 * Retorna lista plana [{lineItemId, sku, lineItemIndex, posicao, url}] ordenada por lineItemIndex, posicao.
 *
 * Se pedido não existir → lança ShopifyApiError(code='not_found').
 * Se nenhum line_item tiver "Foto N:" → retorna [] (sem erro; chamador decide se é erro de negócio).
 */
export async function fetchPhotosFromOrder(
  shopifyOrderNumericId: string | number
): Promise<BlocoPhoto[]> {
  const gid = toOrderGid(shopifyOrderNumericId);
  const data = await shopifyGraphQL<GraphQLOrderResponse>(ORDER_QUERY, { id: gid });

  if (!data.order) {
    throw new ShopifyApiError(
      `Shopify order not found: ${shopifyOrderNumericId}`,
      404,
      'not_found'
    );
  }

  const result: BlocoPhoto[] = [];
  const edges = data.order.lineItems.edges;

  edges.forEach((edge, lineItemIndex) => {
    const { id: lineItemId, sku, customAttributes } = edge.node;
    const photos = parsePhotosFromCustomAttributes(customAttributes);

    for (const photo of photos) {
      result.push({
        lineItemId,
        sku,
        lineItemIndex,
        posicao: photo.posicao,
        url: photo.url,
      });
    }
  });

  return result;
}

// Exported for unit testing
export const __internal = { parsePhotosFromCustomAttributes, toOrderGid };
```

- [ ] **Step 2: Verificar typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/shopify/orders.ts
git commit -m "feat: add fetchPhotosFromOrder for shopify bloco photos"
```

---

### Task 6: Diagnostic script — test-shopify-connection

**Files:**
- Create: `scripts/test-shopify-connection.ts`

- [ ] **Step 1: Criar script**

```typescript
// scripts/test-shopify-connection.ts
/**
 * Diagnóstico pré-deploy: valida SHOPIFY_ADMIN_TOKEN e formato dos customAttributes.
 * Pega 3 pedidos de bloco do Supabase, chama Shopify, imprime o que achou.
 *
 * Rodar:
 *   SHOPIFY_ADMIN_TOKEN=shpat_... SHOPIFY_SHOP_DOMAIN=uniqueboxbrasil.myshopify.com \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run test:shopify
 */
import { createClient } from '@supabase/supabase-js';
import { fetchPhotosFromOrder } from '../lib/shopify/orders';
import { ShopifyApiError } from '../lib/shopify/types';

async function main() {
  // 1. Env vars
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[ERR] SUPABASE env vars ausentes');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    db: { schema: 'unique_app' },
  });

  // 2. Pega 3 pedidos de bloco distintos
  const { data: items, error } = await supabase
    .from('itens_producao')
    .select('pedido_id, modelo, personalizacao, pedidos!inner(id_pedido_ecommerce, numero, nome_ecommerce)')
    .ilike('modelo', '%bloco%')
    .not('personalizacao', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[ERR] Query Supabase:', error.message);
    process.exit(1);
  }

  // Deduplica por pedido
  const seen = new Set<string>();
  const samples = (items ?? [])
    .filter((i) => {
      const pid = (i.pedidos as { id_pedido_ecommerce: string }).id_pedido_ecommerce;
      if (!pid || seen.has(pid)) return false;
      seen.add(pid);
      return true;
    })
    .slice(0, 3);

  if (samples.length === 0) {
    console.error('[ERR] Nenhum pedido de bloco histórico encontrado no Supabase');
    process.exit(1);
  }

  console.log(`Testando ${samples.length} pedido(s):\n`);

  let passCount = 0;
  for (const item of samples) {
    const pedido = item.pedidos as { id_pedido_ecommerce: string; numero: number };
    const shopifyId = pedido.id_pedido_ecommerce;
    const tinyNumero = pedido.numero;

    console.log(`--- Pedido Tiny #${tinyNumero} (Shopify ${shopifyId}) ---`);
    try {
      const photos = await fetchPhotosFromOrder(shopifyId);
      if (photos.length === 0) {
        console.log('  ⚠️  Nenhuma foto encontrada nos customAttributes');
        console.log(`  Personalizacao (Tiny, truncada): ${item.personalizacao?.slice(0, 80)}...`);
      } else {
        console.log(`  ✓ ${photos.length} foto(s) extraída(s):`);
        for (const p of photos) {
          console.log(`    - line_item[${p.lineItemIndex}] sku=${p.sku} posicao=${p.posicao}`);
          console.log(`      url=${p.url}`);
        }
        passCount++;
      }
    } catch (err) {
      if (err instanceof ShopifyApiError) {
        console.error(`  ✗ ${err.code}: ${err.message}`);
      } else {
        console.error(`  ✗ unexpected: ${(err as Error).message}`);
      }
    }
    console.log();
  }

  console.log(`Resultado: ${passCount}/${samples.length} pedidos com fotos OK`);
  process.exit(passCount === samples.length ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar o script (requer token do user)**

```bash
export SHOPIFY_ADMIN_TOKEN="shpat_..."
export SHOPIFY_SHOP_DOMAIN="uniqueboxbrasil.myshopify.com"
export NEXT_PUBLIC_SUPABASE_URL="https://...supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
npm run test:shopify
```

Expected: imprime 3 pedidos com fotos extraídas (ou diagnóstico claro do erro). Exit 0 se todos OK.

**Se o pattern `Foto N:` não bater** (ex: o app customização usa outro nome como `_photo_1` ou `custom-image-1`), ajustar a regex em `parsePhotosFromCustomAttributes` (arquivo `lib/shopify/orders.ts`) **antes** de prosseguir com as próximas tasks.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-shopify-connection.ts
git commit -m "chore: add shopify connection diagnostic script"
```

---

### Task 7: Storage module — download e upload de fotos

**Files:**
- Create: `lib/storage/photos.ts`

- [ ] **Step 1: Criar módulo**

```typescript
// lib/storage/photos.ts
import { createServerClient } from '@/lib/supabase/server';

const BUCKET = 'bloco-fotos';
const MAX_DOWNLOAD_RETRIES = 2;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export interface DownloadResult {
  storage_path: string;
  largura_px?: number;
  altura_px?: number;
  tamanho_bytes: number;
  content_type: string;
  public_url: string;
}

function extFromContentType(ct: string): string {
  const mapping: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return mapping[ct.toLowerCase()] ?? 'bin';
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, DOWNLOAD_TIMEOUT_MS);
      if (res.ok) return res;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      }
      lastError = new Error(`Download ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err as Error;
    }
    if (attempt < MAX_DOWNLOAD_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError ?? new Error('Download failed');
}

/**
 * Baixa uma foto do Shopify CDN e re-hospeda no bucket bloco-fotos.
 * Retorna metadata do arquivo no Storage.
 *
 * Path no bucket: <pedido_id>/<item_id>/<posicao>.<ext>
 *
 * Lança erro se o download ou upload falhar após retries.
 */
export async function downloadAndStore(params: {
  pedido_id: string;
  item_id: string;
  posicao: number;
  shopify_url: string;
}): Promise<DownloadResult> {
  const { pedido_id, item_id, posicao, shopify_url } = params;

  const res = await fetchWithRetry(shopify_url);
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  const ext = extFromContentType(contentType);
  const storage_path = `${pedido_id}/${item_id}/${posicao}.${ext}`;

  const supabase = createServerClient();
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storage_path, bytes, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storage_path);

  return {
    storage_path,
    tamanho_bytes: bytes.length,
    content_type: contentType,
    public_url: pub.publicUrl,
  };
}

/**
 * Processa todas as fotos de um conjunto de item_ids.
 * Lê fotos_bloco WHERE status='pendente' AND item_id IN (...), baixa, atualiza cada linha.
 * Retorna {ok, erro} counts.
 */
export async function downloadPendingPhotosForItems(
  itemIds: string[]
): Promise<{ ok: number; erro: number }> {
  if (itemIds.length === 0) return { ok: 0, erro: 0 };

  const supabase = createServerClient();
  const { data: fotos, error } = await supabase
    .from('fotos_bloco')
    .select('id, item_id, posicao, shopify_url, itens_producao!inner(pedido_id)')
    .eq('status', 'pendente')
    .in('item_id', itemIds);

  if (error) throw new Error(`Query fotos_bloco failed: ${error.message}`);

  let ok = 0;
  let erro = 0;

  for (const foto of fotos ?? []) {
    const pedido_id = (foto.itens_producao as { pedido_id: string }).pedido_id;
    try {
      const result = await downloadAndStore({
        pedido_id,
        item_id: foto.item_id,
        posicao: foto.posicao,
        shopify_url: foto.shopify_url,
      });

      await supabase
        .from('fotos_bloco')
        .update({
          storage_path: result.storage_path,
          tamanho_bytes: result.tamanho_bytes,
          content_type: result.content_type,
          status: 'baixada',
          baixada_em: new Date().toISOString(),
          erro_detalhe: null,
        })
        .eq('id', foto.id);

      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from('fotos_bloco')
        .update({ status: 'erro', erro_detalhe: msg })
        .eq('id', foto.id);
      erro++;
    }
  }

  // Atualiza flag tem_fotos_bloco
  for (const itemId of itemIds) {
    const { count } = await supabase
      .from('fotos_bloco')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', itemId)
      .eq('status', 'baixada');

    await supabase
      .from('itens_producao')
      .update({ tem_fotos_bloco: (count ?? 0) > 0 })
      .eq('id', itemId);
  }

  return { ok, erro };
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/storage/photos.ts
git commit -m "feat: add photo download and storage module"
```

---

### Task 8: Enrichment — persistir SKU

**Files:**
- Modify: `lib/tiny/enrichment.ts`

- [ ] **Step 1: Adicionar `sku` ao tipo EnrichmentResult['items']**

Abrir `lib/tiny/enrichment.ts`. Localizar a definição do interface `EnrichmentResult` (~linha 6). Adicionar `sku: string | null` ao shape de `items`:

```typescript
interface EnrichmentResult {
  items: Array<{
    modelo: string;
    molde: string | null;
    fonte: string | null;
    personalizacao: string | null;
    has_personalizacao: boolean;
    tiny_nf_id: number;
    numero_nf: number;
    sku: string | null;       // <-- NOVO
  }>;
  // ... resto igual
}
```

- [ ] **Step 2: Persistir `sku` no item dentro do loop de enrichment**

Dentro de `enrichOrder`, no loop `for (const entry of orderData.itens ?? [])` (~linha 78), substituir o `push` por uma versão que inclui `sku`:

```typescript
for (let i = 0; i < quantidade; i++) {
  items.push({
    modelo: descricao,
    molde,
    fonte,
    personalizacao,
    has_personalizacao: hasPerson,
    tiny_nf_id: tinyNfId,
    numero_nf: numeroNf,
    sku: sku ?? null,         // <-- NOVO (sku já existe na linha logo acima)
  });
}
```

- [ ] **Step 3: Incluir `sku` no INSERT em `saveEnrichmentResults`**

Localizar `saveEnrichmentResults` (~linha 116), no `supabase.from('itens_producao').insert(...)`, adicionar `sku` ao objeto:

```typescript
await supabase.from('itens_producao').insert(
  result.items.map((item) => ({
    pedido_id: pedidoId,
    modelo: item.modelo,
    molde: item.molde,
    fonte: item.fonte,
    personalizacao: item.personalizacao,
    has_personalizacao: item.has_personalizacao,
    tiny_nf_id: item.tiny_nf_id,
    numero_nf: item.numero_nf,
    sku: item.sku,           // <-- NOVO
  }))
);
```

- [ ] **Step 4: Verificar typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add lib/tiny/enrichment.ts
git commit -m "feat: persist sku in itens_producao during enrichment"
```

---

### Task 9: Enrichment — disparar pipeline de bloco

**Files:**
- Modify: `lib/tiny/enrichment.ts`
- Modify: `lib/types/index.ts`

- [ ] **Step 1: Adicionar types no lib/types/index.ts**

Abrir `lib/types/index.ts`, adicionar no fim do arquivo:

```typescript
export interface FotoBloco {
  id: string;
  item_id: string;
  posicao: number;
  shopify_url: string;
  storage_path: string | null;
  largura_px: number | null;
  altura_px: number | null;
  tamanho_bytes: number | null;
  content_type: string | null;
  status: 'pendente' | 'baixada' | 'erro';
  erro_detalhe: string | null;
  baixada_em: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Adicionar função helper em lib/tiny/enrichment.ts**

Topo do arquivo, após imports, adicionar import:

```typescript
import { fetchPhotosFromOrder } from '@/lib/shopify/orders';
import { downloadPendingPhotosForItems } from '@/lib/storage/photos';
import { ShopifyApiError } from '@/lib/shopify/types';
```

No fim do arquivo (fora de funções existentes), adicionar:

```typescript
/**
 * Para pedidos com itens de bloco, busca URLs de foto no Shopify,
 * cria linhas em fotos_bloco (status=pendente) e dispara download em background.
 *
 * Retorna:
 * - {ok: true} se tudo correu bem
 * - {ok: false, error: {code, message}} se Shopify retornou erro permanente — chamador marca pedido como erro
 *
 * Erros de download individuais (por foto) não geram ok:false; a foto fica com status='erro'
 * mas o pedido segue no fluxo normal, e o gate de geração bloqueia depois.
 */
export async function enrichBlocoPhotos(
  pedidoId: string
): Promise<{ ok: true } | { ok: false, error: { code: string; message: string } }> {
  const supabase = createServerClient();

  // 1. Buscar pedido e itens de bloco
  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select('id, id_pedido_ecommerce')
    .eq('id', pedidoId)
    .single();

  if (pedidoErr || !pedido) {
    return { ok: false, error: { code: 'pedido_not_found', message: pedidoErr?.message ?? 'Not found' } };
  }

  if (!pedido.id_pedido_ecommerce) {
    return { ok: false, error: { code: 'shopify_no_order_id', message: 'Pedido sem id_pedido_ecommerce' } };
  }

  const { data: blocoItems, error: itemsErr } = await supabase
    .from('itens_producao')
    .select('id, sku, created_at')
    .eq('pedido_id', pedidoId)
    .ilike('modelo', '%bloco%')
    .order('created_at', { ascending: true });

  if (itemsErr) {
    return { ok: false, error: { code: 'supabase_query_failed', message: itemsErr.message } };
  }

  if (!blocoItems || blocoItems.length === 0) {
    return { ok: true }; // nada a fazer
  }

  // 2. Chamar Shopify
  let photos;
  try {
    photos = await fetchPhotosFromOrder(pedido.id_pedido_ecommerce);
  } catch (err) {
    if (err instanceof ShopifyApiError) {
      return { ok: false, error: { code: `shopify_${err.code}`, message: err.message } };
    }
    return { ok: false, error: { code: 'shopify_unknown', message: (err as Error).message } };
  }

  if (photos.length === 0) {
    return { ok: false, error: { code: 'shopify_no_photos', message: 'Pedido Shopify sem customAttributes "Foto N:"' } };
  }

  // 3. Match Shopify line_items ↔ Supabase items por SKU
  // Agrupa fotos por SKU + lineItemIndex (pra casos de quantity > 1)
  const photosBySku = new Map<string, typeof photos>();
  for (const p of photos) {
    const key = p.sku ?? '__null__';
    if (!photosBySku.has(key)) photosBySku.set(key, []);
    photosBySku.get(key)!.push(p);
  }

  const itemsBySku = new Map<string, typeof blocoItems>();
  for (const i of blocoItems) {
    const key = i.sku ?? '__null__';
    if (!itemsBySku.has(key)) itemsBySku.set(key, []);
    itemsBySku.get(key)!.push(i);
  }

  // Valida que todo item tem match
  const rowsToInsert: Array<{ item_id: string; posicao: number; shopify_url: string; status: string }> = [];
  for (const [sku, items] of itemsBySku.entries()) {
    const matchedPhotos = photosBySku.get(sku) ?? [];
    if (matchedPhotos.length === 0) {
      return {
        ok: false,
        error: {
          code: 'shopify_item_mismatch',
          message: `Items Supabase com sku=${sku} não têm fotos correspondentes no Shopify`
        }
      };
    }

    // Agrupa fotos por lineItemIndex pra atribuir cada line_item a um item_id
    const photosByLineItem = new Map<number, typeof photos>();
    for (const p of matchedPhotos) {
      if (!photosByLineItem.has(p.lineItemIndex)) photosByLineItem.set(p.lineItemIndex, []);
      photosByLineItem.get(p.lineItemIndex)!.push(p);
    }

    const lineItemIndices = Array.from(photosByLineItem.keys()).sort((a, b) => a - b);

    // Se Shopify tem mais line_items que Supabase tem items do mesmo SKU, é erro
    // (isso pode acontecer se Shopify retornou line_items distintos mas Supabase só criou 1 item — muito raro)
    if (lineItemIndices.length > items.length) {
      return {
        ok: false,
        error: {
          code: 'shopify_item_mismatch',
          message: `Shopify tem ${lineItemIndices.length} line_items com sku=${sku}, Supabase tem ${items.length} items`
        }
      };
    }

    // Atribui cada line_item (em ordem) ao próximo item do Supabase
    lineItemIndices.forEach((lineIdx, posInItems) => {
      const item = items[posInItems];
      if (!item) return;
      const linePhotos = photosByLineItem.get(lineIdx)!;
      for (const p of linePhotos) {
        rowsToInsert.push({
          item_id: item.id,
          posicao: p.posicao,
          shopify_url: p.url,
          status: 'pendente',
        });
      }
    });

    // Se Supabase tem MAIS items que Shopify tem line_items do SKU:
    // assume que o Supabase expandiu por quantity e cada item recebe as mesmas fotos
    // em ordem cíclica — apenas log de warning.
    if (items.length > lineItemIndices.length && lineItemIndices.length > 0) {
      const lastLineIdx = lineItemIndices[lineItemIndices.length - 1]!;
      const lastPhotos = photosByLineItem.get(lastLineIdx)!;
      for (let i = lineItemIndices.length; i < items.length; i++) {
        for (const p of lastPhotos) {
          rowsToInsert.push({
            item_id: items[i]!.id,
            posicao: p.posicao,
            shopify_url: p.url,
            status: 'pendente',
          });
        }
      }
    }
  }

  // 4. Insere rows em fotos_bloco (idempotente via UNIQUE constraint)
  const { error: insertErr } = await supabase
    .from('fotos_bloco')
    .upsert(rowsToInsert, { onConflict: 'item_id,posicao' });

  if (insertErr) {
    return { ok: false, error: { code: 'fotos_bloco_insert_failed', message: insertErr.message } };
  }

  // 5. Dispara download em background (fire-and-forget igual cacheExpeditionLabels)
  const itemIds = Array.from(new Set(rowsToInsert.map((r) => r.item_id)));
  downloadPendingPhotosForItems(itemIds).catch((err) => {
    console.error('[enrichBlocoPhotos] background download failed:', err);
  });

  return { ok: true };
}
```

- [ ] **Step 3: Chamar `enrichBlocoPhotos` no final de `saveEnrichmentResults`**

Em `saveEnrichmentResults`, após o insert de itens e o evento de `status_change`, adicionar:

```typescript
// Se há itens de bloco, disparar pipeline de fotos
const hasBloco = result.items.some((i) => i.modelo.toLowerCase().includes('bloco'));
if (hasBloco) {
  const blocoResult = await enrichBlocoPhotos(pedidoId);
  if (!blocoResult.ok) {
    await supabase
      .from('pedidos')
      .update({ status: 'erro' })
      .eq('id', pedidoId);

    await supabase.from('eventos').insert({
      pedido_id: pedidoId,
      tipo: 'erro',
      descricao: `Falha ao buscar fotos de bloco: ${blocoResult.error.code}`,
      dados: blocoResult.error,
      ator: 'sistema',
    });
  } else {
    await supabase.from('eventos').insert({
      pedido_id: pedidoId,
      tipo: 'api_call',
      descricao: 'Fotos de bloco enfileiradas para download',
      ator: 'sistema',
    });
  }
}
```

- [ ] **Step 4: Verificar typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add lib/types/index.ts lib/tiny/enrichment.ts
git commit -m "feat: trigger shopify photo ingestion pipeline on bloco orders"
```

---

### Task 10: BLOCO_CONFIG

**Files:**
- Modify: `lib/generation/config.ts`

- [ ] **Step 1: Adicionar BLOCO_CONFIG**

No fim de `lib/generation/config.ts`, adicionar:

```typescript
export const BLOCO_CONFIG = {
  TEMPLATE_PATH: path.join(ASSETS_DIR, "templates", "bloco", "Blocos UniqueBox.svg"),
  SLOTS_PER_CHAPA: 30,
  BUCKET: "bloco-fotos",                  // de onde vêm as fotos
  OUTPUT_BUCKET: "uniquebox-files",       // onde sobe o SVG gerado
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add lib/generation/config.ts
git commit -m "feat: add BLOCO_CONFIG with template path and slot count"
```

---

### Task 11: Parser do SVG template

**Files:**
- Create: `lib/generation/bloco.ts` (part 1 — apenas o parser)
- Create: `scripts/test-bloco-parser.ts`

- [ ] **Step 1: Criar o início de lib/generation/bloco.ts com o parser**

```typescript
// lib/generation/bloco.ts
import fs from 'fs';
import { BLOCO_CONFIG } from './config';
import { parseSvg, serializeSvg } from './svg-engine';

/**
 * Slot coordenada no SVG template, após aplicação de todos os transforms.
 * Sistema de coordenadas: origem topo-esquerdo, y cresce pra baixo.
 */
export interface BlocoSlot {
  index: number;    // 0-29
  x: number;        // canto superior esquerdo (SVG units)
  y: number;
  width: number;    // 255.12 nominalmente
  height: number;   // 368.5 nominalmente
}

/**
 * Parser manual de "translate(a,b) rotate(-90)" que o template usa.
 * Aplica: primeiro rotate(-90), depois translate.
 * Em rotate(-90): (x,y) -> (y, -x)
 * Em translate(tx,ty): (x,y) -> (x+tx, y+ty)
 */
function transformRect(
  x: number, y: number, w: number, h: number,
  tx: number, ty: number
): { x: number; y: number; width: number; height: number } {
  // 4 corners no sistema local
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  // Aplicar rotate(-90) seguido de translate(tx, ty)
  const transformed = corners.map(([cx, cy]) => [cy! + tx, -cx! + ty]);
  const xs = transformed.map((p) => p[0]!);
  const ys = transformed.map((p) => p[1]!);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Parseia os 30 rects com class="cls-2" do template e retorna slots ordenados.
 *
 * Ordenação: linha (y crescente) primeiro, depois coluna (x crescente) — leitura ocidental.
 */
export function parseBlocoSlots(svgContent: string): BlocoSlot[] {
  // xmldom não tem querySelectorAll; usa getElementsByTagName + manual filter
  const doc = new (require('@xmldom/xmldom').DOMParser)().parseFromString(svgContent, 'image/svg+xml');
  const rects = Array.from(doc.getElementsByTagName('rect')) as Element[];

  const slots: Array<Omit<BlocoSlot, 'index'>> = [];

  for (const rect of rects) {
    const cls = rect.getAttribute('class') ?? '';
    if (!cls.split(/\s+/).includes('cls-2')) continue;

    const x = parseFloat(rect.getAttribute('x') ?? '0');
    const y = parseFloat(rect.getAttribute('y') ?? '0');
    const w = parseFloat(rect.getAttribute('width') ?? '0');
    const h = parseFloat(rect.getAttribute('height') ?? '0');
    const transform = rect.getAttribute('transform') ?? '';

    // Match "translate(tx ty) rotate(-90)" ou "translate(tx, ty) rotate(-90)"
    const match = transform.match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)\s*rotate\(\s*-90\s*\)/);
    if (!match) {
      // Rect sem transform esperado — ignora
      continue;
    }

    const tx = parseFloat(match[1]!);
    const ty = parseFloat(match[2]!);

    slots.push(transformRect(x, y, w, h, tx, ty));
  }

  // Ordenar: linha (y ~ 68.4, 479.15, ...) depois coluna (x ~ 27.34, 332.57, ...)
  // Tolerância na row grouping: slots na mesma "row" têm y dentro de ±50 unidades
  slots.sort((a, b) => {
    const rowDiff = a.y - b.y;
    if (Math.abs(rowDiff) > 50) return rowDiff;
    return a.x - b.x;
  });

  return slots.map((s, i) => ({ index: i, ...s }));
}

/**
 * Cache do template parseado pra evitar file read a cada chapa.
 */
let cachedTemplate: { content: string; slots: BlocoSlot[] } | null = null;

export function loadBlocoTemplate(): { content: string; slots: BlocoSlot[] } {
  if (cachedTemplate) return cachedTemplate;
  const content = fs.readFileSync(BLOCO_CONFIG.TEMPLATE_PATH, 'utf-8');
  const slots = parseBlocoSlots(content);
  if (slots.length !== BLOCO_CONFIG.SLOTS_PER_CHAPA) {
    throw new Error(
      `Template parser: expected ${BLOCO_CONFIG.SLOTS_PER_CHAPA} slots, got ${slots.length}`
    );
  }
  cachedTemplate = { content, slots };
  return cachedTemplate;
}

// Re-export util pros tests diagnosticos
export const __internal = { transformRect, parseBlocoSlots };
```

- [ ] **Step 2: Criar assertion script**

```typescript
// scripts/test-bloco-parser.ts
/**
 * Valida que o parser acha 30 slots com coordenadas esperadas.
 * Rodar: npm run test:bloco-parser
 */
import assert from 'node:assert/strict';
import { loadBlocoTemplate, __internal } from '../lib/generation/bloco';
import { BLOCO_CONFIG } from '../lib/generation/config';

const { slots } = loadBlocoTemplate();

console.log(`Achou ${slots.length} slots`);

// 1. Quantidade
assert.equal(slots.length, BLOCO_CONFIG.SLOTS_PER_CHAPA, 'Should find 30 slots');

// 2. Dimensões — cada slot deve ser ~255.12 x 368.5 (depois da rotação)
for (const slot of slots) {
  assert.ok(
    Math.abs(slot.width - 255.12) < 0.5,
    `Slot ${slot.index} width=${slot.width} ~ 255.12`
  );
  assert.ok(
    Math.abs(slot.height - 368.5) < 0.5,
    `Slot ${slot.index} height=${slot.height} ~ 368.5`
  );
}

// 3. Ordenação — linha 1 (slots 0-4) tem y ~ 68.4
for (let i = 0; i < 5; i++) {
  assert.ok(
    Math.abs(slots[i]!.y - 68.4) < 1,
    `Slot ${i} deveria estar na linha 1 (y~68.4), tem y=${slots[i]!.y}`
  );
}

// 4. Primeira coluna (slots 0, 5, 10, 15, 20, 25) tem x ~ 27.34
for (const i of [0, 5, 10, 15, 20, 25]) {
  assert.ok(
    Math.abs(slots[i]!.x - 27.34) < 1,
    `Slot ${i} deveria estar na coluna 1 (x~27.34), tem x=${slots[i]!.x}`
  );
}

// 5. Linha 3 (slots 10-14) tem y ~ 877.85 (drift intencional de ~12 vs. padrão)
for (let i = 10; i < 15; i++) {
  assert.ok(
    Math.abs(slots[i]!.y - 877.85) < 1,
    `Slot ${i} deveria estar na linha 3 (y~877.85), tem y=${slots[i]!.y}`
  );
}

console.log('OK');
```

- [ ] **Step 3: Rodar o teste**

```bash
npm run test:bloco-parser
# Esperado: "Achou 30 slots\nOK"
```

- [ ] **Step 4: Commit**

```bash
git add lib/generation/bloco.ts scripts/test-bloco-parser.ts
git commit -m "feat: add bloco svg template parser for 30 slots"
```

---

### Task 12: Packing algorithm

**Files:**
- Modify: `lib/generation/bloco.ts` (append)
- Create: `scripts/test-bloco-packing.ts`

- [ ] **Step 1: Adicionar packing no bloco.ts**

Append ao arquivo `lib/generation/bloco.ts`:

```typescript
// ============================================================
// PACKING ALGORITHM
// ============================================================

export interface FotoToPlace {
  foto_id: string;
  item_id: string;
  pedido_id: string;
  nf_id: number;
  posicao: number;
  public_url: string;
}

export interface PackedFoto extends FotoToPlace {
  chapa_index: number;    // 0-based
  slot_index: number;     // 0-29 (posição na chapa)
}

/**
 * Distribui fotos em chapas de 30 slots.
 * Regras (spec seção 3):
 * - Ordena por nf_id ASC, pedido_id ASC, posicao ASC (caller deve passar já ordenado)
 * - Fotos do mesmo item nunca são split entre chapas diferentes
 * - Se um item não couber na chapa atual, começa uma nova chapa
 * - Slots vazios na chapa parcial não são alocados (chamador remove no render)
 */
export function packFotos(
  fotos: FotoToPlace[],
  slotsPerChapa: number = 30
): PackedFoto[] {
  // Agrupar por item_id preservando ordem (caller ordenou por nf_id, pedido_id, posicao)
  const groupedByItem = new Map<string, FotoToPlace[]>();
  for (const f of fotos) {
    if (!groupedByItem.has(f.item_id)) groupedByItem.set(f.item_id, []);
    groupedByItem.get(f.item_id)!.push(f);
  }

  const result: PackedFoto[] = [];
  let chapaIndex = 0;
  let nextSlot = 0;

  for (const [, itemFotos] of groupedByItem) {
    // Se o item não cabe na chapa atual, pula pra próxima
    if (nextSlot > 0 && nextSlot + itemFotos.length > slotsPerChapa) {
      chapaIndex++;
      nextSlot = 0;
    }
    for (const f of itemFotos) {
      result.push({
        ...f,
        chapa_index: chapaIndex,
        slot_index: nextSlot,
      });
      nextSlot++;
      if (nextSlot >= slotsPerChapa) {
        chapaIndex++;
        nextSlot = 0;
      }
    }
  }

  return result;
}
```

- [ ] **Step 2: Criar assertion script**

```typescript
// scripts/test-bloco-packing.ts
/**
 * Valida o packing algorithm:
 * 1. 30 fotos em 1 item → 1 chapa cheia (slots 0-29)
 * 2. 31 fotos em 1 item (único, 31 fotos) → item NÃO cabe em 30 slots ⇒ fica como bug de negócio
 *    (não esperado no histórico; spec seção 10)
 * 3. 10 pedidos com 3 fotos cada (30 fotos) → 1 chapa, ordem preservada
 * 4. 11 pedidos com 3 fotos cada (33 fotos) → 2 chapas; último pedido não divide, vai pra chapa 2
 * 5. Pedido com 3 fotos precisa caber contíguo mesmo se chapa atual tem < 3 slots livres
 */
import assert from 'node:assert/strict';
import { packFotos, type FotoToPlace } from '../lib/generation/bloco';

function makeFoto(pedido: number, posicao: number): FotoToPlace {
  const nf = pedido; // uma NF por pedido
  return {
    foto_id: `foto-${pedido}-${posicao}`,
    item_id: `item-${pedido}`,           // 1 item por pedido
    pedido_id: `pedido-${pedido}`,
    nf_id: nf,
    posicao,
    public_url: `https://fake/${pedido}-${posicao}.jpg`,
  };
}

// Caso 1: 30 fotos, 10 pedidos × 3 fotos
{
  const fotos: FotoToPlace[] = [];
  for (let p = 1; p <= 10; p++) {
    for (let i = 1; i <= 3; i++) fotos.push(makeFoto(p, i));
  }
  const packed = packFotos(fotos);
  assert.equal(packed.length, 30);
  assert.equal(packed[0]!.chapa_index, 0);
  assert.equal(packed[0]!.slot_index, 0);
  assert.equal(packed[29]!.chapa_index, 0);
  assert.equal(packed[29]!.slot_index, 29);
  console.log('  ✓ caso 1: 30 fotos 1 chapa');
}

// Caso 2: 33 fotos, 11 pedidos × 3 fotos → 2 chapas, pedido 11 em chapa 2 slot 0-2
{
  const fotos: FotoToPlace[] = [];
  for (let p = 1; p <= 11; p++) {
    for (let i = 1; i <= 3; i++) fotos.push(makeFoto(p, i));
  }
  const packed = packFotos(fotos);
  assert.equal(packed.length, 33);
  // Pedido 11: fotos 30, 31, 32 (0-indexed na array packed)
  assert.equal(packed[30]!.pedido_id, 'pedido-11');
  assert.equal(packed[30]!.chapa_index, 1);
  assert.equal(packed[30]!.slot_index, 0);
  assert.equal(packed[32]!.chapa_index, 1);
  assert.equal(packed[32]!.slot_index, 2);
  console.log('  ✓ caso 2: 33 fotos 2 chapas, último pedido contíguo');
}

// Caso 3: 28 fotos + pedido com 3 fotos (31 total) → 28 na chapa 1 + 3 na chapa 2 (pedido não splitta)
{
  const fotos: FotoToPlace[] = [];
  for (let p = 1; p <= 28; p++) fotos.push(makeFoto(p, 1)); // 28 pedidos × 1 foto
  // Pedido 29 com 3 fotos
  for (let i = 1; i <= 3; i++) fotos.push(makeFoto(29, i));

  const packed = packFotos(fotos);
  assert.equal(packed.length, 31);
  // Chapa 0 tem 28 slots usados (slots 0-27); pedido 29 não cabe em 2 slots livres, vai pra chapa 1
  assert.equal(packed[27]!.chapa_index, 0);
  assert.equal(packed[27]!.slot_index, 27);
  assert.equal(packed[28]!.pedido_id, 'pedido-29');
  assert.equal(packed[28]!.chapa_index, 1);
  assert.equal(packed[28]!.slot_index, 0);
  assert.equal(packed[30]!.chapa_index, 1);
  assert.equal(packed[30]!.slot_index, 2);
  console.log('  ✓ caso 3: pedido de 3 fotos não splitta, vai pra chapa seguinte');
}

// Caso 4: 1 foto só
{
  const packed = packFotos([makeFoto(1, 1)]);
  assert.equal(packed.length, 1);
  assert.equal(packed[0]!.chapa_index, 0);
  assert.equal(packed[0]!.slot_index, 0);
  console.log('  ✓ caso 4: 1 foto única');
}

// Caso 5: array vazio
{
  const packed = packFotos([]);
  assert.equal(packed.length, 0);
  console.log('  ✓ caso 5: array vazio');
}

console.log('OK');
```

- [ ] **Step 3: Rodar**

```bash
npm run test:bloco-packing
# Esperado: 5 "✓ caso X" + "OK"
```

- [ ] **Step 4: Commit**

```bash
git add lib/generation/bloco.ts scripts/test-bloco-packing.ts
git commit -m "feat: add bloco packing algorithm with item-contiguous rule"
```

---

### Task 13: Renderer SVG — generateBlocoSvgs

**Files:**
- Modify: `lib/generation/bloco.ts` (append)

- [ ] **Step 1: Adicionar o renderer**

Append ao `lib/generation/bloco.ts`:

```typescript
// ============================================================
// SVG RENDERER
// ============================================================

export interface BlocoSvgOutput {
  content: string;
  filename: string;
  chapa_index: number;
}

export interface GenerateBlocoResult {
  svgs: BlocoSvgOutput[];
  mapa: Array<{
    foto_id: string;
    item_id: string;
    pedido_id: string;
    nf_id: number;
    posicao: number;
    chapa_index: number;
    slot_index: number;
    public_url: string;
  }>;
}

/**
 * Gera um SVG por chapa com as fotos inseridas como <image>.
 * Slots vazios têm os <rect class="cls-2"> removidos.
 */
export function renderBlocoSvgs(
  packed: PackedFoto[],
  timestamp: string = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
): GenerateBlocoResult {
  const { content: templateContent, slots } = loadBlocoTemplate();

  if (packed.length === 0) {
    return { svgs: [], mapa: [] };
  }

  // Agrupar por chapa_index
  const byChapa = new Map<number, PackedFoto[]>();
  for (const p of packed) {
    if (!byChapa.has(p.chapa_index)) byChapa.set(p.chapa_index, []);
    byChapa.get(p.chapa_index)!.push(p);
  }

  const svgs: BlocoSvgOutput[] = [];

  for (const [chapaIndex, chapaFotos] of Array.from(byChapa.entries()).sort((a, b) => a[0] - b[0])) {
    const usedSlots = new Set(chapaFotos.map((f) => f.slot_index));

    // Parse fresh copy do template
    const doc = parseSvg(BLOCO_CONFIG.TEMPLATE_PATH);
    const root = doc.documentElement;

    // Itera rects com class="cls-2" — os mesmos 30 que o parser identifica
    // IMPORTANTE: precisamos mapear slot.index (ordenado) → <rect> DOM original
    // Estratégia: re-parseia slots na mesma ordem que o parser retorna e substitui/remove cada rect in place
    const allRects = Array.from(doc.getElementsByTagName('rect')) as Element[];
    const rectsWithSlots = allRects
      .filter((r) => (r.getAttribute('class') ?? '').split(/\s+/).includes('cls-2'))
      .map((rect) => {
        const x = parseFloat(rect.getAttribute('x') ?? '0');
        const y = parseFloat(rect.getAttribute('y') ?? '0');
        const w = parseFloat(rect.getAttribute('width') ?? '0');
        const h = parseFloat(rect.getAttribute('height') ?? '0');
        const transform = rect.getAttribute('transform') ?? '';
        const match = transform.match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)\s*rotate\(\s*-90\s*\)/);
        if (!match) return null;
        const tx = parseFloat(match[1]!);
        const ty = parseFloat(match[2]!);
        return { rect, slot: (function () {
          const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
          const t = corners.map(([cx, cy]) => [cy! + tx, -cx! + ty]);
          const xs = t.map(p => p[0]!);
          const ys = t.map(p => p[1]!);
          return {
            x: Math.min(...xs), y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          };
        })() };
      })
      .filter((x): x is { rect: Element; slot: { x: number; y: number; width: number; height: number } } => x !== null);

    // Ordena do mesmo jeito que parseBlocoSlots
    rectsWithSlots.sort((a, b) => {
      const rowDiff = a.slot.y - b.slot.y;
      if (Math.abs(rowDiff) > 50) return rowDiff;
      return a.slot.x - b.slot.x;
    });

    // Para cada slot: se preenchido, substitui rect por image; se vazio, remove rect
    rectsWithSlots.forEach((item, slotIdx) => {
      const foto = chapaFotos.find((f) => f.slot_index === slotIdx);
      if (foto) {
        // Criar <image> no mesmo parent do <rect>, com as coords finais
        const imageEl = doc.createElementNS('http://www.w3.org/2000/svg', 'image');
        imageEl.setAttribute('x', String(item.slot.x));
        imageEl.setAttribute('y', String(item.slot.y));
        imageEl.setAttribute('width', String(item.slot.width));
        imageEl.setAttribute('height', String(item.slot.height));
        imageEl.setAttribute('preserveAspectRatio', 'none');
        imageEl.setAttribute('href', foto.public_url);
        item.rect.parentNode?.insertBefore(imageEl, item.rect);
        // Deixa o <rect> visível sobreposto pra manter a borda de corte (class="cls-2" é stroke preto)
      } else if (!usedSlots.has(slotIdx)) {
        // Slot vazio: remove rect
        item.rect.parentNode?.removeChild(item.rect);
      }
    });

    svgs.push({
      content: serializeSvg(doc),
      filename: `chapa_blocos_${chapaIndex + 1}_${timestamp}.svg`,
      chapa_index: chapaIndex,
    });
  }

  const mapa = packed.map((p) => ({
    foto_id: p.foto_id,
    item_id: p.item_id,
    pedido_id: p.pedido_id,
    nf_id: p.nf_id,
    posicao: p.posicao,
    chapa_index: p.chapa_index,
    slot_index: p.slot_index,
    public_url: p.public_url,
  }));

  return { svgs, mapa };
}
```

- [ ] **Step 2: Verificar typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/generation/bloco.ts
git commit -m "feat: add bloco svg renderer with image placement"
```

---

### Task 14: Visual test — test-bloco-template

**Files:**
- Create: `scripts/test-bloco-template.ts`

- [ ] **Step 1: Criar script**

```typescript
// scripts/test-bloco-template.ts
/**
 * Gera 2 SVGs de exemplo pra conferência visual:
 *   tmp/bloco-cheio.svg   — 30 fotos placeholder (chapa completa)
 *   tmp/bloco-parcial.svg — 17 fotos placeholder (verifica remoção de slots vazios)
 *
 * Abrir no browser (ex: `open tmp/bloco-cheio.svg`) e verificar:
 *  - Quadrados coloridos nos 30 slots na ordem correta
 *  - Slots vazios não desenhados no bloco-parcial
 */
import fs from 'fs';
import path from 'path';
import { packFotos, renderBlocoSvgs, type FotoToPlace } from '../lib/generation/bloco';

const TMP_DIR = path.join(process.cwd(), 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

function placeholderDataUrl(label: string, colorIdx: number): string {
  const colors = ['#ff4444', '#44ff44', '#4488ff', '#ffaa22', '#aa44ff', '#ff44aa', '#22ddcc'];
  const color = colors[colorIdx % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 144">
    <rect width="100" height="144" fill="${color}"/>
    <text x="50" y="80" text-anchor="middle" font-size="20" fill="white" font-family="sans-serif">${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function makeFoto(n: number): FotoToPlace {
  return {
    foto_id: `f${n}`,
    item_id: `i${n}`,
    pedido_id: `p${n}`,
    nf_id: n,
    posicao: 1,
    public_url: placeholderDataUrl(String(n), n),
  };
}

// 30 fotos
{
  const fotos = Array.from({ length: 30 }, (_, i) => makeFoto(i + 1));
  const packed = packFotos(fotos);
  const { svgs } = renderBlocoSvgs(packed, '00000000000000');
  const outPath = path.join(TMP_DIR, 'bloco-cheio.svg');
  fs.writeFileSync(outPath, svgs[0]!.content);
  console.log(`  ✓ ${outPath}  (${svgs.length} SVG, chapa cheia)`);
}

// 17 fotos
{
  const fotos = Array.from({ length: 17 }, (_, i) => makeFoto(i + 1));
  const packed = packFotos(fotos);
  const { svgs } = renderBlocoSvgs(packed, '00000000000000');
  const outPath = path.join(TMP_DIR, 'bloco-parcial.svg');
  fs.writeFileSync(outPath, svgs[0]!.content);
  console.log(`  ✓ ${outPath}  (${svgs.length} SVG, chapa parcial — 17 slots preenchidos)`);
}

console.log('OK — abra os arquivos em tmp/ num browser pra conferência visual');
```

- [ ] **Step 2: Rodar**

```bash
npm run test:bloco-template
# Esperado: gera tmp/bloco-cheio.svg e tmp/bloco-parcial.svg
open tmp/bloco-cheio.svg          # macOS; Linux: xdg-open
open tmp/bloco-parcial.svg
```

**Verificação visual:**
- `bloco-cheio.svg`: 30 quadrados coloridos numerados 1-30, ordem de leitura (esquerda→direita, cima→baixo)
- `bloco-parcial.svg`: 17 quadrados coloridos (1-17); slots 18-30 **não devem** aparecer (nenhum retângulo sem foto, nem borda)

Se não passar na verificação visual, investigar o renderer antes de prosseguir.

- [ ] **Step 3: Adicionar tmp/ ao gitignore**

Se `tmp/` não estiver em `.gitignore`, adicionar:

```
# Appended to .gitignore
tmp/
```

- [ ] **Step 4: Commit**

```bash
git add scripts/test-bloco-template.ts .gitignore
git commit -m "chore: add visual test for bloco svg rendering"
```

---

### Task 15: PDF de conferência — bloco

**Files:**
- Create: `lib/generation/bloco-pdf.ts`

- [ ] **Step 1: Criar módulo**

```typescript
// lib/generation/bloco-pdf.ts
import {
  createPdfDocument,
  finalizePdf,
  drawTable,
  drawSummaryTable,
  generateQRCode,
} from './pdf-engine';
import type { GenerateBlocoResult } from './bloco';

export interface BlocoPdfInput {
  mapa: GenerateBlocoResult['mapa'];
  // Info adicional por foto para colunas do PDF
  extraInfo: Map<string, {
    nome_cliente: string;
    numero_pedido: number;
    numero_nf: number | null;
    forma_frete: string;
    tiny_pedido_id: number | null;
    thumbnail_bytes: Buffer;      // thumbnail pré-gerado (delegate ao caller)
  }>;
}

/**
 * Gera o PDF de conferência de blocos: uma linha por foto.
 */
export async function generateBlocoPdf(input: BlocoPdfInput): Promise<Buffer> {
  const doc = createPdfDocument();

  doc.font('Helvetica-Bold').fontSize(14).text('Chapa de Blocos — Conferência', { align: 'center' });
  doc.moveDown(0.5);

  // Ordenar por chapa, slot
  const sorted = [...input.mapa].sort(
    (a, b) => a.chapa_index - b.chapa_index || a.slot_index - b.slot_index
  );

  const rows: Record<string, string | number>[] = [];
  const cellImages = new Map<string, Buffer>();

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]!;
    const extra = input.extraInfo.get(item.foto_id);

    rows.push({
      num: i + 1,
      chapa: `${item.chapa_index + 1}`,
      slot: `${item.slot_index + 1}`,
      cliente: extra?.nome_cliente ?? '',
      pedido: extra?.numero_pedido ?? '',
      nf: extra?.numero_nf ?? '',
      posicao: `Foto ${item.posicao}`,
      frete: extra?.forma_frete ?? '',
      thumb: '',
      qr: '',
    });

    if (extra?.thumbnail_bytes) {
      cellImages.set(`${i}:thumb`, extra.thumbnail_bytes);
    }
    if (extra?.tiny_pedido_id) {
      const url = extra.forma_frete.trim().toLowerCase() === 'retirada'
        ? `https://erp.tiny.com.br/retirada#edit/${extra.tiny_pedido_id}`
        : `https://erp.tiny.com.br/vendas#edit/${extra.tiny_pedido_id}`;
      const qrBuf = await generateQRCode(url, 28);
      cellImages.set(`${i}:qr`, qrBuf);
    }
  }

  drawTable(doc, {
    columns: [
      { header: '#', key: 'num', width: 22 },
      { header: 'Chapa', key: 'chapa', width: 35 },
      { header: 'Slot', key: 'slot', width: 30 },
      { header: 'Thumb', key: 'thumb', width: 40 },
      { header: 'Cliente', key: 'cliente', width: 90 },
      { header: 'Pedido', key: 'pedido', width: 50 },
      { header: 'NF', key: 'nf', width: 45 },
      { header: 'Foto', key: 'posicao', width: 45 },
      { header: 'Frete', key: 'frete', width: 55 },
      { header: 'QR', key: 'qr', width: 45 },
    ],
    rows,
    cellImages,
  });

  doc.moveDown(1);

  // Resumo: fotos por chapa
  const chapaCounts = new Map<string, number>();
  for (const item of sorted) {
    const k = `Chapa ${item.chapa_index + 1}`;
    chapaCounts.set(k, (chapaCounts.get(k) ?? 0) + 1);
  }
  drawSummaryTable(doc, 'Fotos por chapa', chapaCounts, 'Chapa');

  return finalizePdf(doc);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/generation/bloco-pdf.ts
git commit -m "feat: add bloco conference pdf with thumbnails and slot mapping"
```

---

### Task 16: Extender processUniqueBoxBatch

**Files:**
- Modify: `lib/generation/batch-processor.ts`
- Modify: `lib/generation/index.ts`

- [ ] **Step 1: Exportar módulo bloco em index.ts**

Abrir `lib/generation/index.ts`, adicionar:

```typescript
export * from './bloco';
```

- [ ] **Step 2: Importar no batch-processor.ts**

No topo de `lib/generation/batch-processor.ts`, adicionar:

```typescript
import {
  renderBlocoSvgs,
  packFotos,
  type FotoToPlace,
} from './bloco';
import { generateBlocoPdf } from './bloco-pdf';
```

- [ ] **Step 3: Adicionar helper no mesmo arquivo**

Adicionar no topo do arquivo, após os imports:

```typescript
/**
 * Carrega fotos de um lote em formato pronto pro packing.
 * Query: ordenada por nf_id ASC, pedido_id ASC, posicao ASC (spec seção 5.4).
 */
async function loadFotosForLote(loteId: string): Promise<FotoToPlace[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('itens_producao')
    .select(`
      id,
      pedido_id,
      fotos_bloco (id, posicao, storage_path, status),
      pedidos!inner (id, tiny_pedido_id, nome_cliente, forma_frete, notas_fiscais(tiny_nf_id))
    `)
    .eq('lote_id', loteId)
    .ilike('modelo', '%bloco%');

  if (error) throw new Error(`Erro ao buscar fotos do lote: ${error.message}`);

  const bucket = 'bloco-fotos';
  const results: Array<FotoToPlace & { nome_cliente: string; forma_frete: string; tiny_pedido_id: number | null; numero_nf: number | null; }> = [];

  for (const item of (data ?? [])) {
    const pedido = item.pedidos as {
      id: string;
      tiny_pedido_id: number | null;
      nome_cliente: string | null;
      forma_frete: string | null;
      notas_fiscais: Array<{ tiny_nf_id: number }> | null;
    };
    const nfId = pedido.notas_fiscais?.[0]?.tiny_nf_id ?? 0;
    const fotos = (item.fotos_bloco as Array<{ id: string; posicao: number; storage_path: string | null; status: string }>) ?? [];

    for (const foto of fotos) {
      if (foto.status !== 'baixada' || !foto.storage_path) continue;
      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(foto.storage_path);
      results.push({
        foto_id: foto.id,
        item_id: item.id,
        pedido_id: item.pedido_id,
        nf_id: nfId,
        posicao: foto.posicao,
        public_url: pub.publicUrl,
        nome_cliente: pedido.nome_cliente ?? '',
        forma_frete: pedido.forma_frete ?? '',
        tiny_pedido_id: pedido.tiny_pedido_id,
        numero_nf: nfId || null,
      });
    }
  }

  // Ordenar: nf_id ASC, pedido_id ASC, posicao ASC
  results.sort((a, b) => a.nf_id - b.nf_id || a.pedido_id.localeCompare(b.pedido_id) || a.posicao - b.posicao);
  return results;
}
```

- [ ] **Step 4: Estender `processUniqueBoxBatch` com bifurcação**

Localizar `processUniqueBoxBatch` em `lib/generation/batch-processor.ts`. Depois do step "2. Build messages" e antes do upload, **separar itens**:

Substituir o bloco de geração de arquivos (steps 5-6) pelo fluxo abaixo:

```typescript
  // 4b. Separar boxItems (sem "bloco") de blocoItems
  const boxItemIds = new Set(items.filter((i: Record<string, unknown>) =>
    !String(i.modelo ?? '').toLowerCase().includes('bloco')
  ).map((i: Record<string, unknown>) => i.id as string));

  const boxMessages = messages.filter((m) => boxItemIds.has(m._item_id ?? ''));

  // 5. Generate files
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const pdfFilename = `conferencia_${timestamp}.pdf`;
  const storagePrefix = getStoragePath(loteId);
  const bucket = "uniquebox-files";
  const arquivosResult: Array<{ tipo: string; storage_path: string }> = [];

  // 5a. UniqueBox chapa texto (só se houver boxItems personalizadas)
  if (boxMessages.length > 0) {
    const svgContent = generateUniqueBoxSvg(boxMessages);
    if (svgContent) {
      const svgFilename = `chapa_unica_${timestamp}.svg`;
      const svgBuffer = Buffer.from(svgContent, "utf-8");
      const svgPath = `${storagePrefix}/${svgFilename}`;
      await supabase.storage.from(bucket).upload(svgPath, svgBuffer, {
        contentType: "image/svg+xml",
      });
      await supabase.from("arquivos").insert({
        lote_id: loteId,
        tipo: "svg",
        nome_arquivo: svgFilename,
        storage_path: svgPath,
        storage_bucket: bucket,
        tamanho_bytes: svgBuffer.length,
      });
      arquivosResult.push({ tipo: "svg", storage_path: svgPath });
    }
  }

  // 5b. Chapas de blocos (se houver itens de bloco)
  const fotos = await loadFotosForLote(loteId);
  let blocoMapa: Awaited<ReturnType<typeof renderBlocoSvgs>>['mapa'] = [];
  let thumbnails = new Map<string, Buffer>();
  if (fotos.length > 0) {
    const packed = packFotos(fotos.map(f => ({
      foto_id: f.foto_id,
      item_id: f.item_id,
      pedido_id: f.pedido_id,
      nf_id: f.nf_id,
      posicao: f.posicao,
      public_url: f.public_url,
    })));
    const { svgs, mapa } = renderBlocoSvgs(packed, timestamp);
    blocoMapa = mapa;

    // Upload de cada SVG de bloco
    for (const svg of svgs) {
      const svgPath = `${storagePrefix}/${svg.filename}`;
      const svgBuffer = Buffer.from(svg.content, "utf-8");
      await supabase.storage.from(bucket).upload(svgPath, svgBuffer, {
        contentType: "image/svg+xml",
      });
      await supabase.from("arquivos").insert({
        lote_id: loteId,
        tipo: "svg",
        nome_arquivo: svg.filename,
        storage_path: svgPath,
        storage_bucket: bucket,
        tamanho_bytes: svgBuffer.length,
      });
      arquivosResult.push({ tipo: "svg", storage_path: svgPath });
    }

    // Baixa thumbnails pras fotos do mapa (pra usar no PDF)
    for (const m of mapa) {
      try {
        const res = await fetch(m.public_url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          thumbnails.set(m.foto_id, buf);
        }
      } catch {
        // thumbnail opcional; PDF segue sem
      }
    }
  }

  // 5c. PDF de conferência — texto OU blocos OU mistos
  const pdfBuffer = fotos.length > 0
    ? await generateBlocoPdf({
        mapa: blocoMapa,
        extraInfo: new Map(
          fotos.map((f) => [f.foto_id, {
            nome_cliente: f.nome_cliente,
            numero_pedido: 0, // preencher se precisar
            numero_nf: f.numero_nf,
            forma_frete: f.forma_frete,
            tiny_pedido_id: f.tiny_pedido_id,
            thumbnail_bytes: thumbnails.get(f.foto_id) ?? Buffer.alloc(0),
          }])
        ),
      })
    : await generateUniqueBoxPdf(boxMessages);

  const pdfPath = `${storagePrefix}/${pdfFilename}`;
  await supabase.storage.from(bucket).upload(pdfPath, pdfBuffer, {
    contentType: "application/pdf",
  });
  await supabase.from("arquivos").insert({
    lote_id: loteId,
    tipo: "pdf",
    nome_arquivo: pdfFilename,
    storage_path: pdfPath,
    storage_bucket: bucket,
    tamanho_bytes: pdfBuffer.length,
  });
  arquivosResult.push({ tipo: "pdf", storage_path: pdfPath });
```

(Substitui a lógica atual entre o "// 5. Generate files" e "// 7. Update item statuses" de hoje.)

- [ ] **Step 5: Verificar typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add lib/generation/index.ts lib/generation/batch-processor.ts
git commit -m "feat: bifurcate box and bloco items in processUniqueBoxBatch"
```

---

### Task 17: Gate de fotos em `/api/producao/gerar`

**Files:**
- Modify: `app/api/producao/gerar/route.ts`

- [ ] **Step 1: Adicionar helper no topo do arquivo (após imports)**

```typescript
/**
 * Verifica se pedidos com itens de bloco têm fotos em erro/pendente.
 * Retorna lista detalhada se houver problema, ou null se tudo OK.
 */
async function checkBlocoFotosReady(
  pedidoIds: string[],
  supabase: ReturnType<typeof createServerClient>
): Promise<{ itens: Array<{ item_id: string; pedido_id: string; fotos_erro: number; fotos_pendente: number }> } | null> {
  const { data, error } = await supabase
    .from('itens_producao')
    .select('id, pedido_id, fotos_bloco(status)')
    .in('pedido_id', pedidoIds)
    .ilike('modelo', '%bloco%');

  if (error) throw new Error(`Gate check failed: ${error.message}`);

  const problems: Array<{ item_id: string; pedido_id: string; fotos_erro: number; fotos_pendente: number }> = [];

  for (const item of data ?? []) {
    const fotos = (item.fotos_bloco as Array<{ status: string }>) ?? [];
    const erro = fotos.filter((f) => f.status === 'erro').length;
    const pendente = fotos.filter((f) => f.status === 'pendente').length;

    if (erro > 0 || pendente > 0) {
      problems.push({
        item_id: item.id,
        pedido_id: item.pedido_id,
        fotos_erro: erro,
        fotos_pendente: pendente,
      });
    }
  }

  return problems.length > 0 ? { itens: problems } : null;
}
```

- [ ] **Step 2: Aplicar o gate antes do loop de grupos**

Na `POST` handler, após a classificação em grupos e antes do `for (const group of Object.values(groups))`:

```typescript
    // GATE — verifica fotos para grupos com bloco
    const pedidoIdsComBloco = Object.values(groups)
      .filter((g) => g.tipo_personalizacao === 'bloco' || g.tipo_personalizacao === 'box_bloco')
      .flatMap((g) => g.pedidos.map((p) => p.id));

    if (pedidoIdsComBloco.length > 0) {
      const problem = await checkBlocoFotosReady(pedidoIdsComBloco, supabase);
      if (problem) {
        return NextResponse.json(
          {
            error: 'fotos_com_problema',
            message: 'Pedidos com bloco têm fotos em erro ou pendente. Resolva antes de gerar.',
            itens: problem.itens,
          },
          { status: 409 }
        );
      }
    }
```

- [ ] **Step 3: Verificar typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/api/producao/gerar/route.ts
git commit -m "feat: add gate for bloco photos before creating expedition"
```

---

### Task 18: Endpoint de retry de fotos

**Files:**
- Create: `app/api/bloco/fotos/retry/route.ts`

- [ ] **Step 1: Criar endpoint**

```typescript
// app/api/bloco/fotos/retry/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';
import { downloadAndStore } from '@/lib/storage/photos';

const schema = z.object({
  foto_ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'foto_ids invalido' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: fotos, error: queryErr } = await supabase
    .from('fotos_bloco')
    .select('id, item_id, posicao, shopify_url, itens_producao!inner(pedido_id)')
    .in('id', parsed.data.foto_ids);

  if (queryErr) {
    return NextResponse.json({ error: queryErr.message }, { status: 500 });
  }

  const results: Array<{ foto_id: string; status: 'baixada' | 'erro'; error?: string }> = [];

  for (const foto of fotos ?? []) {
    try {
      const pedido_id = (foto.itens_producao as { pedido_id: string }).pedido_id;
      const r = await downloadAndStore({
        pedido_id,
        item_id: foto.item_id,
        posicao: foto.posicao,
        shopify_url: foto.shopify_url,
      });
      await supabase
        .from('fotos_bloco')
        .update({
          storage_path: r.storage_path,
          tamanho_bytes: r.tamanho_bytes,
          content_type: r.content_type,
          status: 'baixada',
          baixada_em: new Date().toISOString(),
          erro_detalhe: null,
        })
        .eq('id', foto.id);
      results.push({ foto_id: foto.id, status: 'baixada' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from('fotos_bloco')
        .update({ status: 'erro', erro_detalhe: msg })
        .eq('id', foto.id);
      results.push({ foto_id: foto.id, status: 'erro', error: msg });
    }
  }

  await supabase.from('eventos').insert({
    tipo: 'api_call',
    descricao: `Retry de ${results.length} foto(s); sucesso=${results.filter((r) => r.status === 'baixada').length}`,
    dados: { results },
    ator: authResult.id,
  });

  return NextResponse.json({ results });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/bloco/fotos/retry/route.ts
git commit -m "feat: add retry endpoint for failed bloco photos"
```

---

### Task 19: UI — card de retry em /pedidos/[id]

**Files:**
- Modify: `app/(dashboard)/pedidos/[id]/page.tsx`

- [ ] **Step 1: Ler o arquivo atual pra entender estrutura**

```bash
cd platform
head -50 app/\(dashboard\)/pedidos/\[id\]/page.tsx
# Nota padrões de Card, ações, fetching
```

- [ ] **Step 2: Adicionar fetching das fotos e componente de card**

Dentro do componente da página server-side, adicionar a query pra fotos do pedido. O arquivo já tem um `createServerClient()` sendo usado pra buscar o pedido — reaproveitar a mesma instância:

```tsx
// No topo do arquivo, garantir o import:
import { createServerClient } from '@/lib/supabase/server';

// Dentro do componente async (page default export), reusar ou criar o client:
const supabase = createServerClient();

// (Se o componente já tem um `supabase` em escopo, não recriar)

const fotosProblema: Array<{
  id: string;
  item_id: string;
  posicao: number;
  shopify_url: string;
  status: 'erro' | 'pendente';
  erro_detalhe: string | null;
}> = [];

if (pedido && (pedido.tipo_personalizacao === 'bloco' || pedido.tipo_personalizacao === 'box_bloco')) {
  // Fetch fotos com problema
  const { data } = await supabase
    .from('fotos_bloco')
    .select('id, item_id, posicao, shopify_url, status, erro_detalhe, itens_producao!inner(pedido_id)')
    .eq('itens_producao.pedido_id', pedidoId)
    .in('status', ['erro', 'pendente']);

  if (data) {
    fotosProblema.push(
      ...data.map((d) => ({
        id: d.id,
        item_id: d.item_id,
        posicao: d.posicao,
        shopify_url: d.shopify_url,
        status: d.status as 'erro' | 'pendente',
        erro_detalhe: d.erro_detalhe,
      }))
    );
  }
}
```

- [ ] **Step 3: Renderizar o card (quando fotosProblema.length > 0)**

Adicionar na JSX, próximo aos outros cards de info:

```tsx
{fotosProblema.length > 0 && (
  <BlocoFotosRetryCard fotos={fotosProblema} />
)}
```

E criar (ou anexar no mesmo arquivo ou em `components/pedidos/bloco-fotos-retry-card.tsx`):

```tsx
// components/pedidos/bloco-fotos-retry-card.tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';

interface Props {
  fotos: Array<{
    id: string;
    item_id: string;
    posicao: number;
    shopify_url: string;
    status: 'erro' | 'pendente';
    erro_detalhe: string | null;
  }>;
}

export function BlocoFotosRetryCard({ fotos }: Props) {
  const [retrying, setRetrying] = useState(false);

  async function retryAll() {
    setRetrying(true);
    try {
      const res = await fetch('/api/bloco/fotos/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foto_ids: fotos.map((f) => f.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Retry falhou');

      const baixadas = data.results.filter((r: { status: string }) => r.status === 'baixada').length;
      const erros = data.results.length - baixadas;
      if (erros === 0) {
        toast.success(`${baixadas} foto(s) baixadas com sucesso`);
      } else {
        toast.warning(`${baixadas} ok, ${erros} com erro`);
      }
      // Refresh
      window.location.reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-amber-800 dark:text-amber-200">
            ⚠️ {fotos.length} foto(s) com problema
          </h3>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            Não será possível gerar a chapa até resolver.
          </p>
        </div>
        <button
          onClick={retryAll}
          disabled={retrying}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {retrying ? 'Tentando...' : 'Tentar novamente'}
        </button>
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        {fotos.map((f) => (
          <li key={f.id} className="flex items-start gap-2">
            <span className="mt-0.5 inline-block rounded-full bg-amber-200 px-1.5 text-xs text-amber-800">
              Foto {f.posicao}
            </span>
            <div className="flex-1">
              <div className="text-amber-900 dark:text-amber-100">
                Status: {f.status}{f.erro_detalhe ? ` — ${f.erro_detalhe}` : ''}
              </div>
              <a
                href={f.shopify_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-600 underline hover:text-amber-800"
              >
                URL original (Shopify)
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Verificar typecheck + build**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add components/pedidos/bloco-fotos-retry-card.tsx app/\(dashboard\)/pedidos/\[id\]/page.tsx
git commit -m "feat: add bloco photos retry card on pedido detail page"
```

---

### Task 20: Script de backfill

**Files:**
- Create: `scripts/backfill-bloco-photos.ts`

- [ ] **Step 1: Criar script**

```typescript
// scripts/backfill-bloco-photos.ts
/**
 * Backfill de fotos de bloco para pedidos em aberto (status pronto_producao ou em_producao).
 *
 * 1. Popula sku em itens_producao que não têm (usa Tiny API para buscar pedido)
 * 2. Para cada pedido com bloco, chama enrichBlocoPhotos (mesma função do webhook)
 *
 * Rodar:
 *   SHOPIFY_ADMIN_TOKEN=... SHOPIFY_SHOP_DOMAIN=uniqueboxbrasil.myshopify.com \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   TINY_ACCESS_TOKEN=... \
 *   npm run backfill:bloco-photos
 */
import { createClient } from '@supabase/supabase-js';
import { enrichBlocoPhotos } from '../lib/tiny/enrichment';
import { fetchOrder } from '../lib/tiny/client';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: 'unique_app' } }
  );

  // 1. Pedidos em aberto com item de bloco
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, tiny_pedido_id, numero, itens_producao!inner(id, modelo, sku)')
    .in('status', ['pronto_producao', 'em_producao'])
    .ilike('itens_producao.modelo', '%bloco%');

  if (error) throw new Error(error.message);
  if (!pedidos || pedidos.length === 0) {
    console.log('Nenhum pedido em aberto com item de bloco. Nada a fazer.');
    return;
  }

  console.log(`Encontrados ${pedidos.length} pedido(s) em aberto para backfill.\n`);

  let okCount = 0;
  let errCount = 0;

  for (const pedido of pedidos) {
    console.log(`--- Pedido ${pedido.numero} (id=${pedido.id}) ---`);

    // 1a. Popular SKU se faltando
    const itensSemSku = (pedido.itens_producao as Array<{ id: string; modelo: string; sku: string | null }>)
      .filter((i) => !i.sku);

    if (itensSemSku.length > 0) {
      console.log(`  Populando sku em ${itensSemSku.length} item(ns)...`);
      try {
        const order = await fetchOrder(pedido.tiny_pedido_id);
        const tinyItems = order.itens ?? [];

        // Para cada item sem SKU no Supabase, tenta achar no Tiny pelo modelo (descricao)
        for (const item of itensSemSku) {
          const match = tinyItems.find((ti) => ti.produto?.descricao === item.modelo);
          if (match?.produto?.sku) {
            await supabase
              .from('itens_producao')
              .update({ sku: match.produto.sku })
              .eq('id', item.id);
          }
        }
      } catch (err) {
        console.error(`  ✗ Falha ao buscar Tiny: ${(err as Error).message}`);
        errCount++;
        continue;
      }
    }

    // 1b. Chamar enrichBlocoPhotos
    const result = await enrichBlocoPhotos(pedido.id);
    if (result.ok) {
      console.log('  ✓ Enfileirado');
      okCount++;
    } else {
      console.error(`  ✗ ${result.error.code}: ${result.error.message}`);
      errCount++;
    }

    // Rate limit mínimo pra não estourar Shopify
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nResultado: ${okCount} ok, ${errCount} erro (total ${pedidos.length})`);
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backfill-bloco-photos.ts
git commit -m "chore: add one-shot backfill script for open bloco orders"
```

---

### Task 21: Smoke test runbook

**Files:**
- Create: `docs/plans/runbook-bloco-smoke-test.md`

- [ ] **Step 1: Escrever runbook**

```markdown
# Smoke test — Chapa de blocos

**Pré-requisitos:**
- Deploy feito em ambiente de staging (ou dev com dados reais)
- Migration 008 aplicada
- Env vars configuradas (`SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_SHOP_DOMAIN`)
- Backfill rodado
- `npm run test:shopify` passou

## Passo 1 — Novo pedido (fluxo webhook)

1. Criar pedido teste no Shopify com 1 item "Blocos Tipo Lego 39 Peças" e 2 fotos
2. Aguardar Tiny receber o pedido
3. Aguardar webhook processar (~5s)
4. Conferir no Supabase:
   ```sql
   SELECT p.numero, p.status, ip.modelo, COUNT(fb.id)
   FROM pedidos p JOIN itens_producao ip ON ip.pedido_id = p.id
   LEFT JOIN fotos_bloco fb ON fb.item_id = ip.id
   WHERE p.tiny_pedido_id = <ID>
   GROUP BY p.numero, p.status, ip.modelo;
   ```
5. Esperado: `status='pronto_producao'`, 2 fotos, status='baixada'
6. Conferir bucket `bloco-fotos`: ver `<pedido_id>/<item_id>/1.jpg` e `2.jpg`

## Passo 2 — Gerar lote

1. UI `/gerar-molde` → selecionar o pedido → "Gerar"
2. Esperado: API retorna 202, cria expedição
3. Conferir `arquivos`:
   ```sql
   SELECT nome_arquivo, tipo FROM arquivos
   WHERE lote_id = (SELECT id FROM lotes_producao ORDER BY created_at DESC LIMIT 1);
   ```
4. Esperado: `chapa_blocos_1_*.svg` e `conferencia_*.pdf`
5. Baixar o SVG e abrir no browser — conferir 2 fotos nos primeiros 2 slots, slots 3-30 limpos

## Passo 3 — Box + Bloco misto

1. Criar pedido com 1 item UniqueBox mensagem + 1 item bloco com 3 fotos
2. Repetir passos 1-2
3. Esperado: 1 SVG de texto + 1 SVG de blocos + 1 PDF no mesmo lote

## Passo 4 — Erro simulado

1. `UPDATE fotos_bloco SET status='erro' WHERE id = <alguma>` (simular foto quebrada)
2. Tentar gerar lote — esperado: 409 com detalhe
3. Na UI `/pedidos/[id]`: card laranja com "1 foto com problema"
4. Clicar "Tentar novamente" — esperado: toast de resultado, recarrega
5. `UPDATE fotos_bloco SET status='baixada' WHERE id = <mesma>` (restaurar)
6. Tentar gerar lote de novo — esperado: 202, ok

## Passo 5 — Paginação de chapas

1. Criar (ou usar existentes) vários pedidos com bloco totalizando >30 fotos
2. Gerar lote único com todos
3. Esperado: 2+ arquivos `chapa_blocos_N_*.svg`
4. Abrir cada — conferir ordem por NF crescente + fotos do mesmo pedido não splittadas

## Monitoração pós-deploy (primeira semana)

```sql
SELECT DATE_TRUNC('day', created_at) AS dia, status, COUNT(*) AS n
FROM fotos_bloco GROUP BY 1, 2 ORDER BY 1 DESC, 2;
```
- Se %erro > 5%, investigar `shopify_url` e `erro_detalhe` agrupados.
```

- [ ] **Step 2: Commit**

```bash
git add docs/plans/runbook-bloco-smoke-test.md
git commit -m "docs: add smoke test runbook for bloco feature"
```

---

## Verificação final antes de PR

- [ ] **Verificar todos os commits estão coerentes**: `git log --oneline origin/main..HEAD`
- [ ] **Rodar full typecheck**: `npx tsc --noEmit` — sem erros
- [ ] **Rodar full build**: `npm run build` — passa
- [ ] **Rodar todos diagnostic scripts**:
  - `npm run test:bloco-parser` → OK
  - `npm run test:bloco-packing` → OK
  - `npm run test:shopify` → OK (precisa token)
  - `npm run test:bloco-template` → abrir os SVGs gerados manualmente e conferir
- [ ] **Abrir PR** no GitHub com link pro spec e link pro runbook
- [ ] **PR body**: resumo + checklist de smoke test + menção à necessidade de rodar `npm run backfill:bloco-photos` uma vez pós-deploy

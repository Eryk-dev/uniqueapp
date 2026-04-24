# Spec: Geração automática de chapa de blocos com fotos do cliente

**Data:** 2026-04-24
**Status:** Aprovado para implementação
**Escopo:** platform/ (Next.js App Router)

## 1. Contexto e problema

A plataforma gera automaticamente chapas de impressão/corte para produtos personalizados das famílias UniqueBox (mensagens de texto) e UniqueKids (nomes infantis). Cada família tem seu pipeline: um webhook recebe o pedido do Tiny, enriquece os dados, classifica os itens e o `processXxxBatch` gera os SVGs/PDFs via módulos em `lib/generation/`.

Os produtos da família UniqueBox chamados "Blocos Tipo Lego" exigem fotos do cliente — e não texto. A arte foi preparada em um molde único `assets/templates/bloco/Blocos UniqueBox.svg` com 30 slots portrait de 255.12×368.5 unidades. Hoje não existe automação para gerar essa chapa: os pedidos são classificados corretamente como `tipo_personalizacao='bloco'` (ou `'box_bloco'`) no kanban, mas o `processUniqueBoxBatch` só lida com mensagens de texto — blocos não produzem arquivo.

Há ainda um bloqueio de dados: o campo `infoAdicional` do Tiny é truncado em 255 caracteres, cortando a 3ª URL de `Foto 3:` quando o cliente sobe três fotos. Das 81 ordens de bloco históricas no Supabase, 11 (14%) estão com dados incompletos. O campo `itens_producao.personalizacao` é `text` sem limite, então o corte vem da integração Shopify→Tiny upstream.

## 2. Objetivo

Gerar automaticamente uma chapa SVG de blocos (+ PDF de conferência) para cada lote de produção que contenha itens de bloco, com as fotos corretas do cliente posicionadas nos 30 slots do molde. Resolver em paralelo o truncamento das URLs conectando diretamente ao Shopify Admin API.

## 3. Decisões tomadas (com racional resumido)

| # | Decisão | Racional |
|---|---|---|
| 1 | URLs buscadas direto no Shopify (não no Tiny) | Elimina truncamento em 255 chars |
| 2 | Packing: cada foto = 1 slot; lote com >30 fotos → múltiplos SVGs | Simples, casa com padrão UniqueKids |
| 3 | Ordenação por NF crescente + fotos do mesmo item contíguas (nunca split entre chapas) | Rastreabilidade física; operador separa blocos do mesmo cliente sem confusão |
| 4 | Slots vazios **não** são desenhados (chapa parcial "limpa") | Preferência visual do operador |
| 5 | Foto já vem pré-cropada pelo app de customização Shopify → `preserveAspectRatio="none"` | Uma ordem de complexidade a menos |
| 6 | Eager fetch: webhook do Tiny dispara Shopify + download + rehospedagem | Dados estáveis; produção não depende de Shopify/CDN online |
| 7 | Nova tabela `unique_app.fotos_bloco` (normalizada) | Status por foto; retry individual; diagnóstico SQL fácil |
| 8 | Estende `processUniqueBoxBatch` (não cria `linha_produto='bloco'`) | Bloco é produto da família UniqueBox; dimensão correta é `tipo_personalizacao` |
| 9 | PDF de conferência: 1 linha por foto, com thumbnail + posição chapa/slot | Rastreabilidade máxima na bancada |
| 10 | Erro híbrido: Shopify retry 3× e bloqueia pedido; download retry 2× e marca foto; gate antes de gerar chapa | Protege produção sem travar por falha pontual de CDN |
| 11 | Backfill só de pedidos em aberto (`status IN ('pronto_producao', 'em_producao')`) | Evita mexer em histórico fechado; cobre o risco do dia do deploy |
| 12 | Dois buckets: `bloco-fotos` (fotos persistentes) + `uniquebox-files` (chapas/PDF gerados) | Ciclos de vida diferentes; políticas RLS separadas |
| 13 | Matching Shopify ↔ Supabase por SKU, com fallback ordenado quando há múltiplas unidades do mesmo SKU | Único campo confiável presente em ambos |

## 4. Arquitetura

Duas camadas novas ligadas ao pipeline existente, sem quebra de contrato:

### 4.1 Camada de ingestão (Shopify → Supabase)

- `lib/shopify/client.ts` — client GraphQL Admin API (auth via `SHOPIFY_ADMIN_TOKEN`, retry exponencial em 5xx/429)
- `lib/shopify/orders.ts` — `fetchPhotosFromOrder(shopifyOrderId)` → `[{posicao, url, sku}]`
- `lib/storage/photos.ts` — `downloadAndStore(fotoId)` usando fetch + upload ao bucket
- Extensão em `lib/tiny/enrichment.ts` — depois de criar as linhas em `itens_producao`, se `linha_produto='uniquebox'` e existem itens com modelo contendo "bloco", dispara o pipeline de fotos

### 4.2 Camada de geração (Supabase → SVG/PDF)

- `lib/generation/bloco.ts` — `generateBlocoSvgs(fotos)` e `generateBlocoPdf(fotosComMapa)`
  - Carrega `Blocos UniqueBox.svg` uma vez (cache em memória)
  - Parseia os 30 `<rect class="cls-2">`: aplica cada `transform` manualmente pra achar bounding box final → `{slot_n, x, y, w, h}`
  - Para cada chapa, substitui os `<rect>` preenchidos por `<image href="..." x y w h preserveAspectRatio="none"/>` e remove os `<rect>` não preenchidos
  - Retorna `{svgs: [{content, filename}], mapa: [{foto_id, chapa_n, slot_n}]}`
- Extensão em `lib/generation/batch-processor.ts` (`processUniqueBoxBatch`):
  - Separa `boxItems` (sem "bloco" no modelo) de `blocoItems`
  - Gera SVG de texto para `boxItems` (comportamento atual)
  - Gera SVGs de blocos via query `fotos_bloco` ordenada por NF/pedido/posicao
  - Gera PDF unificado com ambos os tipos

### 4.3 Componentes novos (arquivos)

```
platform/
├── lib/
│   ├── shopify/
│   │   ├── client.ts
│   │   ├── orders.ts
│   │   └── types.ts
│   ├── storage/
│   │   └── photos.ts
│   └── generation/
│       ├── bloco.ts
│       └── bloco-pdf.ts         (ou adição ao pdf-engine.ts existente)
├── scripts/
│   ├── test-shopify-connection.ts
│   ├── test-bloco-template.ts
│   └── backfill-bloco-photos.ts
├── app/api/bloco/fotos/retry/
│   └── route.ts
└── supabase/migrations/
    └── <ts>_fotos_bloco.sql
```

### 4.4 Componentes estendidos (edits em arquivos existentes)

- `lib/tiny/enrichment.ts` — persiste `sku` em todos os itens; adiciona chamada Shopify + downloader quando há bloco
- `lib/generation/batch-processor.ts` — `processUniqueBoxBatch` bifurca box/bloco
- `lib/generation/config.ts` — adiciona `BLOCO_CONFIG` com path do template
- `app/api/producao/gerar/route.ts` — adiciona gate de fotos em erro/pendente
- `app/(dashboard)/pedidos/[id]/page.tsx` — card de fotos com retry
- `lib/types/index.ts` — tipos para `FotoBloco`

### 4.5 Componentes que NÃO mudam

- Schema de `pedidos`, `lotes_producao`, `expedicoes`, `arquivos`, `eventos`
- Classificação `tipo_personalizacao` (já existe)
- Roteamento `linha_produto` (continua `'uniquebox'` pra bloco)
- Agrupamento por forma de frete
- Fluxo do Tiny Agrupamento / expedição / etiquetas

## 5. Modelo de dados

### 5.1 Nova tabela `unique_app.fotos_bloco`

```sql
CREATE TABLE unique_app.fotos_bloco (
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

CREATE INDEX fotos_bloco_item_id_idx ON unique_app.fotos_bloco(item_id);
CREATE INDEX fotos_bloco_status_erro_idx
  ON unique_app.fotos_bloco(status) WHERE status = 'erro';

-- Trigger pra updated_at segue padrão existente em unique_app
```

### 5.2 Alterações em `unique_app.itens_producao`

```sql
ALTER TABLE unique_app.itens_producao
  ADD COLUMN tem_fotos_bloco boolean NOT NULL DEFAULT false,
  ADD COLUMN sku text;
```

- `tem_fotos_bloco` — populado pelo enrichment quando o item é de bloco; serve pra UI filtrar/mostrar rapidamente sem join.
- `sku` — **coluna nova necessária pro matching Shopify ↔ Supabase**. O valor já vem do Tiny (`entry.produto.sku` em `enrichment.ts`) mas hoje não é persistido. Populado pelo enrichment atualizado pra todos os itens (não só bloco). Para pedidos históricos, o backfill lê via Tiny API (já está buscando o pedido) e faz `UPDATE itens_producao SET sku = ...`.

### 5.3 Novo bucket `bloco-fotos` no Supabase Storage

- **Public read:** sim (igual outros buckets; URL estável pra embutir no SVG)
- **RLS:** idêntica aos buckets `uniquebox-files`/`uniquekids-files`
- **Path:** `<pedido_id>/<item_id>/<posicao>.<ext>`
- **Exemplo:** `a8b3c.../72727abd.../1.jpg`

### 5.4 Query-chave pra geração

```sql
SELECT
  fb.id AS foto_id, fb.storage_path, fb.posicao,
  ip.id AS item_id, p.numero AS numero_pedido, p.id AS pedido_id,
  COALESCE(MIN(nf.tiny_nf_id), 0) AS nf_id
FROM unique_app.itens_producao ip
JOIN unique_app.fotos_bloco fb ON fb.item_id = ip.id AND fb.status = 'baixada'
JOIN unique_app.pedidos p ON p.id = ip.pedido_id
LEFT JOIN unique_app.notas_fiscais nf ON nf.pedido_id = p.id
WHERE ip.lote_id = $1 AND ip.modelo ILIKE '%bloco%'
GROUP BY fb.id, fb.storage_path, fb.posicao, ip.id, p.numero, p.id
ORDER BY nf_id ASC, p.id ASC, fb.posicao ASC;
```

## 6. Fluxos

### 6.1 Ingestão (pedido novo)

1. Tiny envia webhook → `/api/webhooks/tiny-pedido`
2. `enrichOrder(pedidoId, nfId, tinyPedidoId, 'uniquebox')` roda normalmente e cria `itens_producao`
3. Se algum item tem `modelo ILIKE '%bloco%'`:
   1. `fetchPhotosFromOrder(pedido.id_pedido_ecommerce)` via GraphQL Admin API
   2. Retry 3× exponencial em 5xx/429; 401/403/404 bloqueiam pedido sem retry
   3. Match por SKU entre `line_items[].sku` (Shopify) e `itens_producao.sku` (Supabase, populado pelo enrichment atualizado). Se múltiplos itens mesmo SKU: ordena `line_items` por `index` do Shopify e atribui na ordem da query `itens_producao` por `created_at ASC` — determinístico.
   4. Para cada `(item_id, posicao, url)`: `INSERT INTO fotos_bloco (status='pendente')` (idempotente via `UNIQUE (item_id, posicao)`)
4. Dispara download em background sem aguardar (padrão já usado em `cacheExpeditionLabels` — fire-and-forget via `.catch(() => {})`; sem queue worker, sem fila externa):
   1. Para cada foto pendente: GET da URL Shopify (retry 2×)
   2. Upload ao bucket `bloco-fotos`
   3. Update foto com metadata e `status='baixada'`
5. Atualiza `itens_producao.tem_fotos_bloco = true` quando há ao menos 1 foto baixada

### 6.2 Geração (operador clica "gerar molde")

1. Operador seleciona pedidos na UI → `POST /api/producao/gerar`
2. Classifica por `tipo_personalizacao` (comportamento atual)
3. **GATE NOVO:** para cada grupo com 'bloco', query de fotos em `erro`/`pendente`. Se houver, retorna **409** com lista detalhada; cliente mostra modal de retry
4. Se passar, cria expedição Tiny + lote + expedição + dispara `triggerProduction(lote.id, 'uniquebox')`
5. `processUniqueBoxBatch` bifurca:
   - `boxItems` → `generateUniqueBoxSvg` (código atual)
   - `blocoItems` → query de fotos + `generateBlocoSvgs`
   - Ambos → `generateConferenciaPdf` unificado
6. Uploads no `uniquebox-files/<YYYY-MM>/<DD>/<lote_id>/`

### 6.3 Retry manual

- `POST /api/bloco/fotos/retry { foto_ids }` → re-executa downloader e devolve novo status

### 6.4 Backfill

- `npm run backfill:bloco-photos` (script one-shot)
- Filtra `pedidos.status IN ('pronto_producao', 'em_producao')` com item de bloco
- Reaproveita a mesma função de ingestão (6.1 passo 3 em diante)
- Idempotente via `UNIQUE (item_id, posicao)` — se já existe, faz UPDATE

## 7. Tratamento de erros

Ver seção 4 do brainstorming — resumo:

- Shopify 5xx/429/timeout → retry 3× → se falhar, `pedidos.status='erro'`
- Shopify 401/403 → sem retry, `erro_detalhe='shopify_auth_failed'` + evento crítico
- Shopify 404 → `erro_detalhe='shopify_order_not_found'`
- Matching SKU falha → `erro_detalhe='shopify_item_mismatch'`, dados do mismatch no evento
- Foto individual falha download → `fotos_bloco.status='erro'`, outras seguem
- Gate de geração bloqueia se houver fotos em `erro`/`pendente` — response 409 com detalhes
- Novos tipos de evento: `shopify_fetch_*`, `foto_download_failed`, `bloco_gate_blocked`, `bloco_retry_*`

UI de retry aparece no `/pedidos/[id]` quando há fotos com problema. Bulk retry fica pra v2.

## 8. Testes

Sem suíte de testes na codebase hoje. Estratégia pragmática:

- **Script `test-shopify-connection.ts`** — valida token, busca 3 pedidos históricos, imprime `customAttributes`, valida matching SKU. Rodar pré-deploy.
- **Script `test-bloco-template.ts`** — parseia template, gera SVG de teste com quadrados coloridos pra conferência visual; gera 2 amostras (30 fotos / 17 fotos).
- **Smoke test manual** — pedido teste no Shopify → webhook manual → confere DB + Storage + SVG + PDF. Antes de liberar prod.
- **Monitoração** — query SQL semanal no `fotos_bloco` agrupando por status; alertar se >5% em erro.

Casos de borda testados manualmente: 1 foto / 3 fotos / box+bloco / lote com múltiplas chapas / chapa parcial / URL quebrada proposital / re-run do backfill.

## 9. Dependências externas

- **Shopify Admin API access token** (`shpat_...`) — a ser gerado no app existente (`api key a7a196c86b7e13d038fc81cadb1260c1`, loja `uniqueboxbrasil.myshopify.com`)
- **Scopes mínimos:** `read_orders`, `read_all_orders`, `read_products`
- **Nova env var:** `SHOPIFY_ADMIN_TOKEN`
- **A API Key/Secret do app Shopify que foi colada no chat durante o brainstorming deve ser rotacionada** antes do deploy, por segurança

## 10. Fora do escopo (explicitamente)

- Tela de bulk retry (centenas de fotos em erro)
- Configuração formal de Vitest/Jest na codebase
- Webhook do Shopify (pra detectar atualização de foto pós-compra)
- Pre-crop das fotos no lado servidor (confia no Shopify app)
- Pedido avulso com bloco (o `/avulso/uniquebox` não ganha variante de bloco nesta entrega)
- Suporte a >30 fotos em um único item de pedido (não visto no histórico)

## 11. Abordagem de entrega

Big bang — 1 PR único com todas as mudanças (decisão do usuário). Ordem de commits sugerida dentro da PR:

1. Migration `fotos_bloco` + colunas `tem_fotos_bloco` e `sku` + bucket `bloco-fotos`
2. `lib/shopify/*` + script de diagnóstico
3. Extensão `enrichment.ts` pra persistir SKU (independente do bloco; já ajuda)
4. `lib/storage/photos.ts` + extensão `enrichment.ts` pro fluxo de bloco
5. `lib/generation/bloco.ts` + template parser + SVG generation
6. Extensão `batch-processor.ts` + `generateConferenciaPdf` atualizado
7. Gate + endpoint de retry + UI do card
8. Script de backfill (roda 2 passos: popula SKU histórico + baixa fotos)

## 12. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Nome real do custom attribute no Shopify difere de "Foto N:" | Média | Alto (sem fetch funcional) | Script de diagnóstico antes de codar o parser; flexível a patterns "Foto\s*\d+\s*:" ou similar |
| SKU não é único por line_item no Shopify | Baixa | Médio | Fallback ordenado; logar mismatch com detalhes |
| Shopify API rate limit em lote de backfill grande | Baixa | Médio | Backoff + concorrência limitada no script |
| Imagem Shopify CDN expira/é deletada entre fetch e download | Muito baixa | Baixo | Retry + erro_detalhe; operador re-tenta |
| Template SVG tem drift de +12 unidades entre rows 2-3 (detectado no parse) | Confirmado | Nenhum | Parser usa coordenadas finais calculadas; drift não afeta placement |
| Campo SKU não está salvo hoje em `itens_producao` | Confirmado | Resolvido | Migration adiciona coluna `sku`; enrichment atualizado persiste; backfill popula histórico |

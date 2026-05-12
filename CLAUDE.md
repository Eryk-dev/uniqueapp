# UniqueApp — guia para Claude Code

App Next.js de produção/expedição da Unique. Integra Tiny ERP (pedidos, etiquetas) e Shopify, com Supabase como backend.

## Estrutura do Supabase

Confirmado em 2026-05-04. Existem **3 project refs** que aparecem nesse repo, com papéis diferentes:

### `tkfpbcyjmaifuvfjqobn` — DBs do uniqueapp (este repo)
- Onde moram **todas as databases** do app de expedição.
- Schema usado: `unique_app` (definido em `lib/supabase/client.ts` via `db: { schema: 'unique_app' }`).
- Tabelas principais (ver `supabase/migrations/001_initial_schema.sql` ... `012_add_pedidos_kits.sql`): `pedidos`, `usuarios`, `webhook_logs`, `fila_execucao`, `fotos_bloco`, etc.
- Configurado em `.env.production.example` como `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

### `ehbxpbeijofxtsbezwxd` — Storage bucket (e outros apps da empresa)
- **Bucket de Storage** usado pelo uniqueapp (`STORAGE_SUPABASE_URL` / `STORAGE_SUPABASE_SERVICE_ROLE_KEY` em `.env.production.example`).
- Hospeda também outros apps da empresa que **não** são o uniqueapp:
  - **Lever (RH)** — schemas `public` e `lever_finance`.
  - **Projeto novo uniquebox (Shopify abandono de carrinho + Kommo)** — schema `uniquebox` (`shopify_events`, `cart_recovery_events`, `kommo_jobs`, `kommo_api_log`).
- (`.mcp.json` agora roda em modo account-wide — sem `project_ref` na URL — então o MCP do Supabase enxerga os 3 projetos via OAuth da conta do Leonardo.)

### `zjkjhzzhpxiakuhloftc` — obsoleto
- Aparece em `.env` local mas as DBs reais estão em `tkfpbcyjmaifuvfjqobn`. Tratar como `.env` stale.

### Regras práticas
- MCP do Supabase está em modo **account-wide** (`.mcp.json` sem `project_ref`). Pra operar num projeto específico, passar o `project_id` correspondente nas chamadas das tools.
- DBs do app de expedição → `tkfpbcyjmaifuvfjqobn`.
- Storage / Lever HR / projeto novo uniquebox → `ehbxpbeijofxtsbezwxd`.

## Deploy

- Deploy via **EasyPanel**: `git push origin main` + rebuild manual no painel.
- Sempre encadear `git push origin main` logo após commit de fix — senão o EasyPanel rebuilda commit antigo.

## Geração de PDFs (folhas de conferência e etiquetas)

### Folhas de conferência — 4 geradores

| Arquivo | Título | Quando | Caller |
|---|---|---|---|
| `lib/generation/conferencia-unificada.ts` | `Conferência — Box + Bloco — Exp <num> — <data hora>` | Lote misto (box + bloco) | `batch-processor.ts` |
| `lib/generation/uniquebox.ts` | `Chapa Única - Conferência — Exp <num> — <data hora>` | Lote só de box | `batch-processor.ts` |
| `lib/generation/bloco-pdf.ts` | `Chapa de Blocos — Conferência — Exp <num> — <data hora>` | Lote só de bloco | `batch-processor.ts` |
| `lib/generation/uniquekids.ts` | `Folha de Conferência — Exp <num> — <data hora>` | Lote kids | `batch-processor.ts` |

- O sufixo `Exp <num>` vem de `expedicoes.numero_expedicao` (mesmo campo que nomeia o arquivo `conferencia-{exp}.pdf`).
- A `<data hora>` vem de `expedicoes.created_at`, formatada `dd/MM/yyyy HH:mm` em `America/Sao_Paulo` (`formatDataGeracaoBR` em `batch-processor.ts`). Ex: `Exp 1234 — 12/05/2026 14:32`.
- Quando qualquer dos dois falta, o sufixo correspondente é omitido (título cai pro padrão sem sufixo).
- Os 4 callers ficam em `lib/generation/batch-processor.ts` — params `numeroExpedicao`/`dataGeracao` (uniquebox/conferencia/bloco) e `numeroExpedicaoKids`/`dataGeracaoKids` (kids).

### Etiqueta DANFE local — `lib/generation/danfe-etiqueta.ts`

Gerada pelo app (em vez de baixar do Tiny) quando `expedicoes.forma_frete` contém **`package`**, **`retirada`** ou **`jadlog`** (Tiny não devolve etiqueta dessas modalidades). Lógica em `app/api/expedicoes/[id]/etiquetas/pdf/route.ts` (`isLocalDanfe`).

Layout A6 paisagem com banner colorido no topo identificando a modalidade:
- **PACKAGE** — fundo preto
- **RETIRADA NA LOJA** — fundo laranja (#E8821C)
- **JADLOG** — fundo azul (#0033A0)

DANFEs locais **não** usam `etiquetas_cache` (cache só vale pra `tiny_agrupamento_id`), então mudanças no layout aparecem imediatamente sem precisar `?refresh=1`.

Preview rápido sem subir o app: `npx tsx scripts/preview-danfe-retirada.ts` → gera `tmp/etiqueta-retirada.pdf`.

## Gate de fotos do bloco em "Gerar Molde"

`app/api/producao/gerar/route.ts` (`checkBlocoFotosReady`, linhas ~17-59) pula qualquer pedido que tenha `fotos_bloco.status` em `'erro'` ou `'pendente'`. Toast da UI: `"Nenhum pedido pode ser gerado — fotos pendentes ou em erro: #<num> <cliente> (N erro)"`.

Causa típica: download da imagem do Shopify CDN falhou (504, timeout, etc.) — o `erro_detalhe` da linha em `fotos_bloco` mostra o motivo. Quase sempre é transitório.

**Como reprocessar:**
- Abre `/pedidos/<id>` — o componente `BlocoFotosRetryCard` (`components/pedidos/bloco-fotos-retry-card.tsx`) aparece no topo listando as fotos em erro/pendente, com botão "tentar novamente" que chama `POST /api/bloco/fotos/retry`.
- Pra disparar via script (fora da UI) precisa de `STORAGE_SUPABASE_SERVICE_ROLE_KEY` do projeto `ehbxpbeijofxtsbezwxd` — o `.env` local só tem credencial do CRM, e o MCP do Supabase só devolve anon/publishable, então essa key tem que vir do dashboard manualmente.

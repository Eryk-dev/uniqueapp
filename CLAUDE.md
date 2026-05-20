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

## Limites operacionais por expedição

`app/api/producao/gerar/route.ts` divide grupos antes de criar agrupamento no Tiny — 1 expedição = 1 chapa física. Pedido nunca é dividido entre expedições (cliente recebe inteiro):

| Tipo do grupo | Limite | O que conta | Constante |
|---|---|---|---|
| `bloco_*`, `box_bloco_*`, `bloco_misto` | 30 fotos | `fotos_bloco.status='baixada'` por pedido | `FOTOS_POR_EXPEDICAO` |
| `uniquebox` (puro box) | 28 personalizadas | itens com `personalizacao` não-vazio (slots do `molde_28.svg`) | `BOX_POR_EXPEDICAO` |
| `uniquekids` | — | (sem limite) | — |

Quando um pedido sozinho ultrapassa o limite, passa intacto (gera múltiplos SVGs/PNGs no mesmo lote — única forma sem partir pedido).

## Cache de etiquetas Tiny

`expedicoes.etiquetas_cache` guarda paths no bucket `etiquetas`. Servido em `app/api/expedicoes/[id]/etiquetas{,/pdf}/route.ts`. Pra forçar re-busca: `?refresh=1`.

**`forceFallback=true` é usado sempre** — o endpoint consolidado `/expedicao/{id}/etiquetas` devolve PDF com páginas em ordem própria do Tiny (não bate com `expedicoes[]` = `nf_ids` do DB = conferência/SVG/PNG). O fallback itera `agrupamento.expedicoes[]` e chama `/expedicao/{ag}/expedicao/{exp}/etiquetas` por envio (custo: +N chamadas Tiny, mas ordem fica consistente).

**Cache nunca persiste parcial:** `fetchAllAgrupamentoLabels` devolve `{ urls, partial }` — `partial=true` quando algum envio não retornou URL (race com geração no Tiny). `cacheExpeditionLabels` pula o `UPDATE expedicoes` nesse caso, então próxima request re-busca do Tiny (já materializado). Sem esse guard, expedições criadas e consultadas rápido demais ficavam com cache faltando etiquetas pra sempre.

## `pedidos.nome_cliente` = destinatário, não faturamento

Desde 2026-05-12, `nome_cliente` prioriza `enderecoEntrega.nomeDestinatario` do Tiny (quem recebe), com fallback pra `cliente.nome` (faturamento). Aplicado em 2 pontos de entrada: `lib/tiny/enrichment.ts` (jobs) e `app/api/webhooks/tiny-pedido/route.ts` (webhook primário). Mesma lógica de `lib/generation/danfe-etiqueta.ts`.

Reflete em todos os consumidores automaticamente: folha de conferência, busca de pedidos, listagem de expedições, cards e UI. Pedidos importados antes desse deploy mantêm o nome de faturamento — não há backfill.

Fallback ativa quando Tiny apaga `enderecoEntrega` (caso típico: pedido com taxa adicional — o endereço fica em `observacoesInternas`).

## Detecção de kit / combo (produto-virtualizado)

`classifyProduto` em `lib/tiny/enrichment.ts` separa 3 tipos com base na descrição (case-insensitive):

| Tipo | Critério | Vira `itens_producao`? | Entra em `pedidos.kits[]`? |
|---|---|:-:|:-:|
| `normal` | qualquer produto sem `Kit ` no começo (Amor Infinito, Bloco, ...) | ✅ | ❌ |
| `kit_puro` | começa com `Kit ` **sem** ` + ` (`Kit declaração de Amor!`, `Kit Surpresa de Amor: Balões...`) | ❌ (virtualizado) | ✅ (nome completo) |
| `combo` | começa com `Kit ` **com** ` + ` (`Kit Pedido de Casamento + UniqueBox Pedido de Casamento`, `Kit Surpresa de Amor + Amor Infinito`, SKUs UB319/UB199/UB200/UB201) | ✅ (chapa personalizada) | ✅ (só a parte antes do `+`) |

Fallback por id `848567371` trata caso de descrição vazia como `kit_puro`.

Pra `kit_puro`, a folha de conferência mostra row rosa "KIT" + ❤ no número do pedido. Pra `combo`, a row do item normal (chapa) fica rosa também (porque o pedido tem entrada em `kits[]`), e a parte "Kit X" aparece como row separada acima. Combos importados antes do commit que introduziu essa lógica (2026-05-20) NÃO geraram `itens_producao` — precisam ser re-enriquecidos ou tratados manualmente.

## Gate de fotos do bloco em "Gerar Molde"

`app/api/producao/gerar/route.ts` (`checkBlocoFotosReady`, linhas ~17-59) pula qualquer pedido que tenha `fotos_bloco.status` em `'erro'` ou `'pendente'`. Toast da UI: `"Nenhum pedido pode ser gerado — fotos pendentes ou em erro: #<num> <cliente> (N erro)"`.

Causa típica: download da imagem do Shopify CDN falhou (504, timeout, etc.) — o `erro_detalhe` da linha em `fotos_bloco` mostra o motivo. Quase sempre é transitório.

**Como reprocessar:**
- Abre `/pedidos/<id>` — o componente `BlocoFotosRetryCard` (`components/pedidos/bloco-fotos-retry-card.tsx`) aparece no topo listando as fotos em erro/pendente, com botão "tentar novamente" que chama `POST /api/bloco/fotos/retry`.
- Pra disparar via script (fora da UI) precisa de `STORAGE_SUPABASE_SERVICE_ROLE_KEY` do projeto `ehbxpbeijofxtsbezwxd` — o `.env` local só tem credencial do CRM, e o MCP do Supabase só devolve anon/publishable, então essa key tem que vir do dashboard manualmente.

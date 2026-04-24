# Smoke test — Chapa de blocos

**Pré-requisitos:**
- Deploy feito em ambiente de staging (ou dev com dados reais)
- Migration 008 aplicada (já feito — aplicada durante Task 1)
- Env vars configuradas: `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_SHOP_DOMAIN=uniqueboxbrasil.myshopify.com`
- Backfill rodado (`npm run backfill:bloco-photos`)
- `npm run test:shopify` passou (valida token + pattern "Foto N:" do Shopify)

## Passo 0 — Validar conexão Shopify (antes de tudo)

```bash
export SHOPIFY_ADMIN_TOKEN="shpat_..."
export SHOPIFY_SHOP_DOMAIN="uniqueboxbrasil.myshopify.com"
export NEXT_PUBLIC_SUPABASE_URL="https://tkfpbcyjmaifuvfjqobn.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
npm run test:shopify
```

Esperado: 3 pedidos com fotos extraídas. Se `pattern "Foto N:" não bate`, ajustar regex em `lib/shopify/orders.ts:parsePhotosFromCustomAttributes` antes de rodar backfill.

## Passo 1 — Novo pedido (fluxo webhook)

1. Criar pedido teste no Shopify com 1 item "Blocos Tipo Lego 39 Peças" e 2 fotos
2. Aguardar Tiny receber o pedido
3. Aguardar webhook processar (~5s)
4. Conferir no Supabase:
   ```sql
   SELECT p.numero, p.status, ip.modelo, COUNT(fb.id) AS fotos, ip.sku
   FROM unique_app.pedidos p
   JOIN unique_app.itens_producao ip ON ip.pedido_id = p.id
   LEFT JOIN unique_app.fotos_bloco fb ON fb.item_id = ip.id
   WHERE p.tiny_pedido_id = <ID>
   GROUP BY p.numero, p.status, ip.modelo, ip.sku;
   ```
5. Esperado: `status='pronto_producao'`, 2 fotos em `status='baixada'`, `sku` populado
6. Conferir bucket `bloco-fotos`: ver `<pedido_id>/<item_id>/1.jpg` e `2.jpg`

## Passo 2 — Gerar lote

1. UI `/gerar-molde` → selecionar o pedido → "Gerar"
2. Esperado: API retorna 202, cria expedição
3. Conferir `arquivos`:
   ```sql
   SELECT nome_arquivo, tipo FROM unique_app.arquivos
   WHERE lote_id = (SELECT id FROM unique_app.lotes_producao ORDER BY created_at DESC LIMIT 1);
   ```
4. Esperado: `chapa_blocos_1_*.svg` e `conferencia_*.pdf` no bucket `uniquebox-files`
5. Baixar o SVG e abrir no browser — conferir 2 fotos nos primeiros 2 slots, slots 3-30 limpos (sem contorno)

## Passo 3 — Box + Bloco misto

1. Criar pedido com 1 item UniqueBox mensagem + 1 item bloco com 3 fotos
2. Repetir passos 1-2
3. Esperado: 1 SVG de texto (`chapa_unica_*.svg`) + 1 SVG de blocos (`chapa_blocos_1_*.svg`) + 1 PDF no mesmo lote

## Passo 4 — Erro simulado

1. Abrir `/pedidos/<id_pedido_bloco>` na UI — **não deve aparecer** nenhum card amber
2. No SQL: `UPDATE unique_app.fotos_bloco SET status='erro', erro_detalhe='test' WHERE id = <alguma>`
3. Recarregar `/pedidos/<id>` — esperado: card laranja "⚠️ 1 foto(s) com problema"
4. Tentar gerar lote com esse pedido — esperado: API retorna 409 com lista detalhada
5. UI mostra modal de erro (ou alerta dependendo da UI de `/gerar-molde`)
6. Clicar "Tentar novamente" no card — esperado: toast de resultado, card some após refresh
7. Restaurar: `UPDATE unique_app.fotos_bloco SET status='baixada', erro_detalhe=NULL WHERE id = <mesma>`
8. Gerar lote de novo — esperado: 202, ok

## Passo 5 — Paginação de chapas

1. Seleciona múltiplos pedidos com bloco totalizando >30 fotos (pode precisar criar vários pedidos teste no Shopify)
2. Gerar lote único com todos
3. Esperado: 2+ arquivos `chapa_blocos_N_*.svg` no `arquivos`
4. Abrir cada SVG — conferir:
   - Ordem por NF crescente
   - Fotos do mesmo pedido **nunca split** entre chapas diferentes (se o pedido tem 3 fotos e não cabem na chapa atual, vão todas pra próxima)

## Passo 6 — Retry individual

1. No SQL: `UPDATE unique_app.fotos_bloco SET status='erro' WHERE id = <alguma>`
2. No terminal:
   ```bash
   curl -X POST http://localhost:3000/api/bloco/fotos/retry \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"foto_ids": ["<uuid>"]}'
   ```
3. Esperado: `{"results":[{"foto_id":"<uuid>","status":"baixada"}]}`

## Monitoração pós-deploy (primeira semana)

```sql
-- Distribuição diária de status
SELECT DATE_TRUNC('day', created_at) AS dia, status, COUNT(*) AS n
FROM unique_app.fotos_bloco GROUP BY 1, 2 ORDER BY 1 DESC, 2;

-- Taxa de erro por dia
SELECT
  DATE_TRUNC('day', created_at) AS dia,
  COUNT(*) FILTER (WHERE status='erro') * 100.0 / NULLIF(COUNT(*),0) AS erro_pct,
  COUNT(*) AS total
FROM unique_app.fotos_bloco GROUP BY 1 ORDER BY 1 DESC LIMIT 14;

-- Quais erros mais comuns
SELECT erro_detalhe, COUNT(*) FROM unique_app.fotos_bloco
WHERE status='erro' GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
```

Alertar se **%erro > 5%** na janela de 7 dias, OU se houver acúmulo de `status='pendente'` (fotos que nunca terminaram download).

## Rollback (se algo quebrar)

1. Reverter commits da branch `feat/bloco-imagens-molde` via `git revert` do merge commit
2. **Não** rodar `DROP TABLE unique_app.fotos_bloco` — manter schema pra próximos attempts
3. **Não** deletar o bucket `bloco-fotos`
4. Deletar env vars `SHOPIFY_ADMIN_TOKEN` do ambiente se quiser desabilitar chamadas Shopify temporariamente (webhook detecta env var ausente e vai pular a etapa de bloco — mas o pedido vai pra `status='erro'` em vez de `pronto_producao`)

Se precisar **pausar** a feature sem rollback de schema: adicionar uma env var `BLOCO_DISABLED=true` e conditional no início de `enrichBlocoPhotos` que retorna `ok:true` sem fazer nada. (Não implementado hoje — pensar se vale pra v2.)

## Checklist final antes do deploy em produção

- [ ] `npm run build` passa
- [ ] `npm run test:bloco-parser` passa
- [ ] `npm run test:bloco-packing` passa
- [ ] `npm run test:bloco-template` — inspecionei visualmente os SVGs gerados
- [ ] `npm run test:shopify` passa com token real
- [ ] API Key/Secret antigas do Shopify rotacionadas (ver spec seção 9)
- [ ] Env vars `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_SHOP_DOMAIN` setadas no ambiente de produção
- [ ] Backfill rodado com sucesso (ou sem pedidos em aberto)
- [ ] Smoke test passos 1-6 executados e OK
- [ ] Merge da branch `feat/bloco-imagens-molde` em `main`

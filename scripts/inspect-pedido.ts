import { readFileSync } from "fs";
import { resolve } from "path";

const env = readFileSync(resolve(__dirname, "../.env"), "utf-8");
for (const line of env.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq > 0) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

import { createClient } from "@supabase/supabase-js";
import { getValidToken } from "../lib/tiny/oauth";

const NUMERO = process.argv[2] ?? "43525";

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    db: { schema: "unique_app" },
  });

  let { data: pedido } = await sb
    .from("pedidos")
    .select("*")
    .eq("numero", Number(NUMERO))
    .maybeSingle();

  if (!pedido) {
    const { data: alt } = await sb
      .from("pedidos")
      .select("*")
      .or(`numero.eq.${NUMERO},numero_ecommerce.eq.${NUMERO}`)
      .limit(1);
    pedido = alt?.[0];
  }

  if (!pedido) {
    console.log(`Pedido ${NUMERO} nao encontrado — tentando buscar por NF...`);
    const { data: nfs } = await sb
      .from("notas_fiscais")
      .select("pedido_id, tiny_nf_id, numero")
      .or(`tiny_nf_id.eq.${NUMERO},numero.eq.${NUMERO}`)
      .limit(1);
    console.log("NFs encontradas:", nfs);
    if (nfs?.[0]) {
      const { data: p2 } = await sb.from("pedidos").select("*").eq("id", nfs[0].pedido_id).single();
      pedido = p2;
    }
  }

  if (!pedido) {
    console.log("Pedido nao encontrado");
    return;
  }

  console.log("=== PEDIDO ===");
  console.log(pedido);

  const { data: itens } = await sb
    .from("itens_producao")
    .select("id, modelo, molde, fonte, personalizacao, has_personalizacao, status, lote_id")
    .eq("pedido_id", pedido.id);

  console.log("\n=== ITENS_PRODUCAO ===");
  console.table(itens);

  console.log("\n=== SKUs NO TINY ===");
  const token = await getValidToken();
  const res = await fetch(
    `https://api.tiny.com.br/public-api/v3/pedidos/${pedido.tiny_pedido_id}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const order = await res.json();
  for (const item of order.itens ?? []) {
    console.log({
      sku: item.produto?.sku ?? null,
      descricao: item.produto?.descricao ?? null,
      infoAdicional: item.infoAdicional ?? null,
      quantidade: item.quantidade,
    });
  }
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});

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

async function main() {
  const token = await getValidToken();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: pedidos } = await sb
    .from("pedidos")
    .select("tiny_pedido_id, numero")
    .eq("linha_produto", "uniquekids")
    .not("tiny_pedido_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  for (const p of pedidos ?? []) {
    const res = await fetch(
      `https://api.tiny.com.br/public-api/v3/pedidos/${p.tiny_pedido_id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const order = await res.json();
    console.log(`\n=== Pedido #${p.numero} (Tiny ID: ${p.tiny_pedido_id}) ===`);
    for (const item of order.itens ?? []) {
      const sku = item.produto?.sku ?? "NULL";
      const desc = item.produto?.descricao ?? "";
      const info = item.infoAdicional ?? "(vazio)";
      const parts = sku.split("-");
      console.log(`  SKU: ${sku}`);
      console.log(`  Descricao: ${desc}`);
      console.log(`  Info Adicional: ${info}`);
      console.log(`  SKU parts: [${parts.join(", ")}] (total: ${parts.length})`);
      console.log(`  parts[5] (molde): ${parts[5] ?? "undefined"}`);
      console.log(`  parts[7] (fonte): ${parts[7] ?? "undefined"}`);
      console.log("");
    }
  }
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});

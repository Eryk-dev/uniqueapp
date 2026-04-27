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

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    db: { schema: "unique_app" },
  });

  const { data: pedidos, error } = await sb
    .from("pedidos")
    .select("id, numero, numero_ecommerce, tiny_pedido_id, linha_produto, status, nome_cliente, created_at")
    .eq("linha_produto", "uniquekids")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) console.log("ERROR:", error);
  console.table(pedidos);
}

main().catch((e) => { console.error(e); process.exit(1); });

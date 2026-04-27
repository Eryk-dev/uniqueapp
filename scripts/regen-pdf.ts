import { readFileSync } from "fs";
import { resolve } from "path";

const envContent = readFileSync(resolve(__dirname, "../.env"), "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx > 0) {
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = val;
  }
}

import { createClient } from "@supabase/supabase-js";
import { expandNames, generateUniqueKidsPdf, type UniqueKidsOrder } from "../lib/generation/uniquekids";
import fs from "fs";

const NUMERO_EXPEDICAO = 4422;

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Find expedition
  const { data: expedition, error: expError } = await supabase
    .from("expedicoes")
    .select("id, lote_id, numero_expedicao")
    .eq("numero_expedicao", NUMERO_EXPEDICAO)
    .single();

  if (expError || !expedition) {
    console.error("Expedição não encontrada:", expError?.message);
    process.exit(1);
  }

  console.log(`Expedição encontrada: lote_id = ${expedition.lote_id}`);

  // 2. Get all items for this lote (regardless of status)
  const { data: rawItems, error: itemsError } = await supabase
    .from("itens_producao")
    .select("*, pedidos(linha_produto, forma_frete, id_forma_frete, id_transportador, nome_cliente, tiny_pedido_id)")
    .eq("lote_id", expedition.lote_id);

  if (itemsError || !rawItems?.length) {
    console.error("Nenhum item encontrado:", itemsError?.message);
    process.exit(1);
  }

  const items = rawItems.filter(
    (i: Record<string, unknown>) =>
      (i as { pedidos?: { linha_produto?: string } }).pedidos?.linha_produto === "uniquekids"
  );

  console.log(`${items.length} itens encontrados`);

  // 3. Convert to UniqueKidsOrder format
  let orders: UniqueKidsOrder[] = items.map((item: Record<string, unknown>) => {
    const pedido = item.pedidos as Record<string, unknown> | undefined;
    return {
      "ID NF": item.tiny_nf_id as number,
      "Numero NF": item.numero_nf as number,
      Molde: (item.molde as string) ?? "",
      Fonte: (item.fonte as string) ?? "",
      "NOME (PERSONAL)": (item.personalizacao as string) ?? "",
      Modelo: (item.modelo as string) ?? "",
      "Forma frete": (pedido?.forma_frete as string) ?? "",
      "Nome Cliente": (pedido?.nome_cliente as string) ?? "",
      "ID pedido": pedido?.tiny_pedido_id as number,
      idFormaFrete: pedido?.id_forma_frete as number,
      _item_id: item.id as string,
      _pedido_id: item.pedido_id as string,
    };
  });

  // 4. Expand multi-name orders
  const expanded: UniqueKidsOrder[] = [];
  for (const order of orders) {
    expanded.push(...expandNames(order));
  }
  orders = expanded;
  orders.sort((a, b) => String(a["ID NF"] ?? "").localeCompare(String(b["ID NF"] ?? "")));

  console.log(`${orders.length} linhas após expandir nomes`);

  // 5. Generate PDF
  const pdfBuffer = await generateUniqueKidsPdf(orders);
  console.log(`PDF gerado: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

  // 6. Find and replace old PDF in storage
  const { data: oldFile } = await supabase
    .from("arquivos")
    .select("*")
    .eq("lote_id", expedition.lote_id)
    .eq("tipo", "pdf")
    .single();

  if (oldFile) {
    // Replace in storage
    await supabase.storage
      .from(oldFile.storage_bucket)
      .update(oldFile.storage_path, pdfBuffer, { contentType: "application/pdf" });

    // Update size
    await supabase
      .from("arquivos")
      .update({ tamanho_bytes: pdfBuffer.length })
      .eq("id", oldFile.id);

    console.log(`PDF substituído no Storage: ${oldFile.storage_path}`);
  } else {
    console.log("Arquivo antigo não encontrado no banco — salvando localmente");
    fs.writeFileSync(`folha_conferencia_EXP${NUMERO_EXPEDICAO}.pdf`, pdfBuffer);
    console.log(`Salvo como folha_conferencia_EXP${NUMERO_EXPEDICAO}.pdf`);
  }

  console.log("Concluído!");
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});

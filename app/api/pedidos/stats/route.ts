import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

const STATUSES = [
  "recebido",
  "aguardando_nf",
  "pronto_producao",
  "em_producao",
  "produzido",
  "expedido",
  "avulso_produzido",
  "erro_fiscal",
  "erro_enriquecimento",
  "erro_producao",
] as const;

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = createServerClient();

  const counts: Record<string, number> = {};

  // Run all count queries in parallel
  const results = await Promise.all(
    STATUSES.map(async (status) => {
      const { count } = await supabase
        .from("pedidos")
        .select("*", { count: "exact", head: true })
        .eq("status", status);
      return { status, count: count ?? 0 };
    })
  );

  for (const r of results) {
    counts[r.status] = r.count;
  }

  // Also compute error total
  counts.erros =
    (counts.erro_fiscal ?? 0) +
    (counts.erro_enriquecimento ?? 0) +
    (counts.erro_producao ?? 0);

  return NextResponse.json({ counts });
}

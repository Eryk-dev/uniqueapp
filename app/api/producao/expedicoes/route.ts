import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

type LoteData = {
  id: string;
  status: string;
  linha_produto: string;
  total_itens: number;
  itens_sucesso: number;
  itens_erro: number;
  created_at: string;
  completed_at: string | null;
};

type ExpRow = {
  id: string;
  lote_id: string | null;
  forma_frete: string;
  nf_ids: number[];
  status: string;
  created_at: string;
  lotes_producao: LoteData | null;
};

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = createServerClient();

  const { data: expeditions, error } = await supabase
    .from("expedicoes")
    .select("*, lotes_producao(*)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const pendente: ExpRow[] = [];
  const em_producao: ExpRow[] = [];
  const pronto: ExpRow[] = [];

  for (const exp of (expeditions ?? []) as ExpRow[]) {
    const lote = exp.lotes_producao;

    if (!lote || lote.status === "processando") {
      if (lote) {
        em_producao.push(exp);
      } else {
        pendente.push(exp);
      }
    } else {
      pronto.push(exp);
    }
  }

  return NextResponse.json({ pendente, em_producao, pronto });
}

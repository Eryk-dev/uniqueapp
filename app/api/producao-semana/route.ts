import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";

// ============================================================
// Produção da Semana — relatório de consumo (Fase 1, read-only)
//
// Agrega quanto saiu de cada SKU/modelo por semana, a partir de
// `itens_producao` ligado a `pedidos` com status produzido/expedido
// (o pipeline termina em 'produzido' — 'expedido' quase nunca é
// marcado, então os dois contam como "saiu").
//
// Sem mudança de schema: lê e agrega em memória. Não há histórico
// year-over-year (dados começam em abr/2026). A "sugestão" default é
// a última semana completa — o sinal mais fresco, que acompanha tanto
// quedas pós-pico quanto rampas de crescimento (uma média de 3 semanas
// ficaria presa no pico antigo quando a demanda cai 30× numa semana,
// como acontece depois do Dia dos Namorados). É editável: perto de
// datas comemorativas o operador ajusta à mão olhando a tendência.
// ============================================================

// Brasil é UTC-3 fixo (sem horário de verão desde 2019).
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

// Início (segunda-feira) da semana de uma data, no fuso de São Paulo.
function spWeekStart(iso: string): string {
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MS);
  const day = d.getUTCDay(); // 0=domingo .. 6=sábado
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type ItemRow = {
  sku: string | null;
  modelo: string;
  created_at: string;
  pedidos: { status: string; linha_produto: string } | null;
};

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = createServerClient();

  const nowIso = new Date().toISOString();
  const currentWeekStart = spWeekStart(nowIso);
  // 8 semanas completas, da mais recente (índice 0) à mais antiga (índice 7).
  const weeks: string[] = Array.from({ length: 8 }, (_, k) =>
    addDays(currentWeekStart, -7 * (k + 1))
  );
  // Busca um pouco antes da 8ª semana pra garantir cobertura.
  const cutoff = addDays(currentWeekStart, -7 * 9) + "T00:00:00Z";

  // PostgREST corta em 1000 linhas por padrão — paginamos até esvaziar.
  const PAGE = 1000;
  const all: ItemRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("itens_producao")
      .select("sku, modelo, created_at, pedidos!inner(status, linha_produto)")
      .in("pedidos.status", ["produzido", "expedido"])
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
    const batch = (data ?? []) as unknown as ItemRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }

  // Agrega por produto (chave = sku, com fallback pro modelo).
  type Acc = {
    sku: string | null;
    modelo: string;
    linha_produto: string;
    byWeek: Map<string, number>; // weekStart -> contagem
    parcial: number; // semana atual (incompleta)
  };
  const map = new Map<string, Acc>();

  for (const row of all) {
    const key = (row.sku && row.sku.trim()) || row.modelo;
    let acc = map.get(key);
    if (!acc) {
      acc = {
        sku: row.sku?.trim() || null,
        modelo: row.modelo,
        linha_produto: row.pedidos?.linha_produto ?? "",
        byWeek: new Map(),
        parcial: 0,
      };
      map.set(key, acc);
    }
    const ws = spWeekStart(row.created_at);
    if (ws === currentWeekStart) {
      acc.parcial += 1;
    } else {
      acc.byWeek.set(ws, (acc.byWeek.get(ws) ?? 0) + 1);
    }
  }

  const rows = Array.from(map.values()).map((acc) => {
    const at = (ws: string) => acc.byWeek.get(ws) ?? 0;
    const ultimaSemana = at(weeks[0]);
    const media4 =
      weeks.slice(0, 4).reduce((s, ws) => s + at(ws), 0) / 4;
    const media8 =
      weeks.reduce((s, ws) => s + at(ws), 0) / 8;
    // Default = última semana completa (sinal mais fresco). Robusto a
    // viradas sazonais; o operador ajusta à mão quando precisar.
    const sugestao = ultimaSemana;
    // Sparkline da mais antiga (esq) à mais recente (dir).
    const sparkline = [...weeks].reverse().map((ws) => at(ws));

    return {
      key: acc.sku ?? acc.modelo,
      sku: acc.sku,
      modelo: acc.modelo,
      linha_produto: acc.linha_produto,
      ultima_semana: ultimaSemana,
      media_4: Math.round(media4 * 10) / 10,
      media_8: Math.round(media8 * 10) / 10,
      sugestao,
      parcial: acc.parcial,
      sparkline,
    };
  });

  // Ordena por relevância recente (média 4 sem), depois média 8 sem.
  rows.sort((a, b) => b.media_4 - a.media_4 || b.media_8 - a.media_8);

  return NextResponse.json({
    generated_at: nowIso,
    current_week_start: currentWeekStart,
    week_starts: weeks, // recente -> antiga
    rows,
  });
}

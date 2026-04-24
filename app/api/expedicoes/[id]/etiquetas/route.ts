import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAllAgrupamentoLabels } from "@/lib/tiny/client";
import { cacheExpeditionLabels } from "@/lib/tiny/expedition";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const supabase = createServerClient();

  const { data: expedition } = await supabase
    .from("expedicoes")
    .select("tiny_agrupamento_id, etiquetas_cache")
    .eq("id", id)
    .single();

  if (!expedition?.tiny_agrupamento_id) {
    return NextResponse.json(
      { error: "Expedicao sem agrupamento no Tiny" },
      { status: 404 }
    );
  }

  // 1. Try serving from cache (unless ?refresh=1)
  const cached = expedition.etiquetas_cache as string[] | null;
  if (!refresh && cached?.length) {
    const urls: string[] = [];
    for (const path of cached) {
      const { data } = await supabase.storage
        .from("etiquetas")
        .createSignedUrl(path, 3600);
      if (data?.signedUrl) urls.push(data.signedUrl);
    }
    if (urls.length > 0) {
      return NextResponse.json({ urls, cached: true });
    }
  }

  // 2. Fallback: fetch from Tiny API
  try {
    const result = await fetchAllAgrupamentoLabels(expedition.tiny_agrupamento_id);
    const urls = result.urls ?? [];

    // Cache in background for next time
    if (urls.length > 0) {
      cacheExpeditionLabels(id, expedition.tiny_agrupamento_id).catch(() => {});
    }

    return NextResponse.json({ urls });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar etiquetas";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

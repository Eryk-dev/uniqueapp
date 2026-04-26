import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
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
    .select("tiny_agrupamento_id, numero_expedicao, etiquetas_cache")
    .eq("id", id)
    .single();

  if (!expedition?.tiny_agrupamento_id) {
    return NextResponse.json(
      { error: "Expedicao sem agrupamento no Tiny" },
      { status: 404 }
    );
  }

  // Resolve a lista de PDFs (cache ou Tiny)
  const buffers: Uint8Array[] = [];
  const cached = expedition.etiquetas_cache as string[] | null;

  if (!refresh && cached?.length) {
    for (const path of cached) {
      const { data } = await supabase.storage.from("etiquetas").download(path);
      if (data) {
        const arr = new Uint8Array(await data.arrayBuffer());
        buffers.push(arr);
      }
    }
  }

  if (buffers.length === 0) {
    try {
      const result = await fetchAllAgrupamentoLabels(expedition.tiny_agrupamento_id);
      const urls = result.urls ?? [];

      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          buffers.push(new Uint8Array(await res.arrayBuffer()));
        } catch {
          // segue as proximas
        }
      }

      if (urls.length > 0) {
        cacheExpeditionLabels(id, expedition.tiny_agrupamento_id).catch(() => {});
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao buscar etiquetas";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (buffers.length === 0) {
    return NextResponse.json({ error: "Nenhuma etiqueta disponivel" }, { status: 404 });
  }

  // Mescla num PDF unico
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    try {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } catch (err) {
      console.warn(
        `[ETIQUETAS_PDF] Falha ao carregar um dos PDFs da expedicao ${id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  if (merged.getPageCount() === 0) {
    return NextResponse.json(
      { error: "Nao foi possivel combinar as etiquetas" },
      { status: 500 }
    );
  }

  const bytes = await merged.save();
  const filename = expedition.numero_expedicao
    ? `etiquetas_${expedition.numero_expedicao}.pdf`
    : `etiquetas_${id}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

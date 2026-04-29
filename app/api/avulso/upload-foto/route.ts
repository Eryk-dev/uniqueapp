import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth/middleware";
import { createStorageClient } from "@/lib/supabase/server";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /api/avulso/upload-foto
 * Body: multipart/form-data com campo 'file'.
 * Sobe pro bucket bloco-fotos em pasta avulso/{uuid}.{ext} e devolve
 * { storage_path, public_url } pra incluir no payload de criacao do bloco.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "campo 'file' obrigatorio" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `tipo nao suportado (${file.type}); use jpeg/png/webp` },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "arquivo > 15MB" }, { status: 413 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storage = createStorageClient();
  const bucket = "bloco-fotos";
  const storagePath = `avulso/${randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await storage.storage
    .from(bucket)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: pub } = storage.storage.from(bucket).getPublicUrl(storagePath);
  return NextResponse.json({ storage_path: storagePath, public_url: pub.publicUrl });
}

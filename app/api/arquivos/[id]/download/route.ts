import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient, createStorageClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const supabase = createServerClient();

  const { data: arquivo } = await supabase
    .from('arquivos')
    .select('*')
    .eq('id', id)
    .single();

  if (!arquivo) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const filename = arquivo.nome_arquivo || `arquivo.${arquivo.tipo || 'bin'}`;

  const storage = createStorageClient();
  const { data: signed, error: signError } = await storage.storage
    .from(arquivo.storage_bucket)
    .createSignedUrl(arquivo.storage_path, 300, { download: filename });

  if (signError || !signed) {
    console.error('[arquivos/download] createSignedUrl failed:', signError);
    return NextResponse.json({ error: 'Failed to sign URL' }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}

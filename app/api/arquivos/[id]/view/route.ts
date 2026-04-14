import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';

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

  const { data: signedUrl } = await supabase.storage
    .from(arquivo.storage_bucket)
    .createSignedUrl(arquivo.storage_path, 300);

  if (!signedUrl?.signedUrl) {
    return NextResponse.json({ error: 'Failed to generate view URL' }, { status: 500 });
  }

  return NextResponse.json({
    url: signedUrl.signedUrl,
    tipo: arquivo.tipo,
    nome_arquivo: arquivo.nome_arquivo,
  });
}

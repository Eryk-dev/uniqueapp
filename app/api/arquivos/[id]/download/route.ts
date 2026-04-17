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

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(arquivo.storage_bucket)
    .download(arquivo.storage_path);

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
  }

  const filename = arquivo.nome_arquivo || `arquivo.${arquivo.tipo || 'bin'}`;

  return new NextResponse(fileData, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

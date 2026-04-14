import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = createServerClient();

  // Fetch recent batches with their files
  const { data: lotes, error } = await supabase
    .from('lotes_producao')
    .select('*, arquivos(*)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  // Only include batches that have files
  const batches = (lotes ?? []).filter(
    (l) => Array.isArray(l.arquivos) && l.arquivos.length > 0
  );

  return NextResponse.json({ batches });
}

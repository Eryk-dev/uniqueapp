import { createClient } from '@supabase/supabase-js';

export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any, 'unique_app'>(url, key, {
    auth: { persistSession: false },
    db: { schema: 'unique_app' },
  });
}

// Storage client points to a separate Supabase project (Storage-only).
// Falls back to the main project's URL/key when the dedicated vars are absent
// so existing dev environments keep working.
export function createStorageClient() {
  const url = process.env.STORAGE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.STORAGE_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing STORAGE_SUPABASE_URL/STORAGE_SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fallback)');
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

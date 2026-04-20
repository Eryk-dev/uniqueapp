import { createClient } from '@supabase/supabase-js';

let client: ReturnType<typeof createClient<any, 'unique_app'>> | null = null;

export function createBrowserClient() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  client = createClient<any, 'unique_app'>(url, key, {
    db: { schema: 'unique_app' },
  });
  return client;
}

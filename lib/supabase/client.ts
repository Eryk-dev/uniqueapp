import { createClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: ReturnType<typeof createClient<any, 'unique_app'>> | null = null;

export function createBrowserClient() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client = createClient<any, 'unique_app'>(url, key, {
    db: { schema: 'unique_app' },
  });
  return client;
}

import { createBrowserClient } from './client';
import type { RealtimeChannel } from '@supabase/supabase-js';

type SubscriptionCallback = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) => void;

export function subscribeTo(
  table: 'pedidos' | 'lotes_producao' | 'tarefas',
  callback: SubscriptionCallback
): RealtimeChannel {
  const supabase = createBrowserClient();

  const channel = supabase
    .channel(`${table}_changes`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        callback({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          new: (payload.new ?? {}) as Record<string, unknown>,
          old: (payload.old ?? {}) as Record<string, unknown>,
        });
      }
    )
    .subscribe();

  return channel;
}

export function unsubscribe(channel: RealtimeChannel) {
  const supabase = createBrowserClient();
  supabase.removeChannel(channel);
}

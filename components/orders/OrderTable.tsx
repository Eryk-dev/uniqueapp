'use client';

import { useRouter } from 'next/navigation';
import type { PedidoWithCount, PedidoStatus } from '@/lib/types';

const STATUS_COLORS: Record<PedidoStatus, string> = {
  recebido: 'bg-gray-100 text-gray-700',
  aguardando_nf: 'bg-amber-100 text-amber-700',
  pronto_producao: 'bg-purple-100 text-purple-700',
  em_producao: 'bg-orange-100 text-orange-700',
  produzido: 'bg-green-100 text-green-700',
  expedido: 'bg-emerald-100 text-emerald-700',
  avulso_produzido: 'bg-teal-100 text-teal-700',
  erro_fiscal: 'bg-red-100 text-red-700',
  erro_enriquecimento: 'bg-red-100 text-red-700',
  erro_producao: 'bg-red-100 text-red-700',
};

interface OrderTableProps {
  orders: PedidoWithCount[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
}

export default function OrderTable({
  orders,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: OrderTableProps) {
  const router = useRouter();
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));

  return (
    <div className="bg-white border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="w-10 px-3 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                className="rounded"
              />
            </th>
            <th className="text-left px-3 py-3 font-medium text-gray-600">Pedido</th>
            <th className="text-left px-3 py-3 font-medium text-gray-600">Cliente</th>
            <th className="text-left px-3 py-3 font-medium text-gray-600">Linha</th>
            <th className="text-left px-3 py-3 font-medium text-gray-600">Status</th>
            <th className="text-left px-3 py-3 font-medium text-gray-600">Frete</th>
            <th className="text-right px-3 py-3 font-medium text-gray-600">Itens</th>
            <th className="text-left px-3 py-3 font-medium text-gray-600">Data</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className="border-b hover:bg-gray-50 cursor-pointer"
              onClick={() => router.push(`/pedidos/${order.id}`)}
            >
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(order.id)}
                  onChange={() => onToggleSelect(order.id)}
                  className="rounded"
                />
              </td>
              <td className="px-3 py-2 font-mono">{order.numero}</td>
              <td className="px-3 py-2">{order.nome_cliente ?? '-'}</td>
              <td className="px-3 py-2">
                <span className="text-xs font-medium uppercase">{order.linha_produto}</span>
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {order.status.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-600">{order.forma_frete ?? '-'}</td>
              <td className="px-3 py-2 text-right">{order.itens_count}</td>
              <td className="px-3 py-2 text-gray-500">
                {new Date(order.created_at).toLocaleDateString('pt-BR')}
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                Nenhum pedido encontrado
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

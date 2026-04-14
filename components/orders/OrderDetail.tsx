'use client';

import type { PedidoDetail } from '@/lib/types';

interface OrderDetailProps {
  data: PedidoDetail;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-500 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value ?? '-'}</span>
    </div>
  );
}

export default function OrderDetail({ data }: OrderDetailProps) {
  const { pedido, nota_fiscal, itens, lote, expedicao, arquivos } = data;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Customer & Order */}
      <Card title="Pedido">
        <Field label="Numero" value={pedido.numero} />
        <Field label="Tiny ID" value={pedido.tiny_pedido_id} />
        <Field label="Cliente" value={pedido.nome_cliente} />
        <Field label="Linha" value={pedido.linha_produto} />
        <Field label="Status" value={pedido.status.replace(/_/g, ' ')} />
        <Field label="Data" value={new Date(pedido.data_pedido).toLocaleDateString('pt-BR')} />
        <Field label="Frete" value={pedido.forma_frete} />
        <Field label="Avulso" value={pedido.is_avulso ? 'Sim' : 'Nao'} />
      </Card>

      {/* NF Info */}
      <Card title="Nota Fiscal">
        {nota_fiscal ? (
          <>
            <Field label="NF ID" value={nota_fiscal.tiny_nf_id} />
            <Field label="Numero" value={nota_fiscal.numero_nf} />
            <Field label="Modelo" value={nota_fiscal.modelo} />
            <Field label="Autorizada" value={nota_fiscal.autorizada ? 'Sim' : 'Nao'} />
            {nota_fiscal.autorizada_at && (
              <Field
                label="Autorizada em"
                value={new Date(nota_fiscal.autorizada_at).toLocaleString('pt-BR')}
              />
            )}
            <Field label="Clone ID" value={nota_fiscal.tiny_pedido_clone_id} />
          </>
        ) : (
          <p className="text-sm text-gray-400">Nenhuma NF gerada</p>
        )}
      </Card>

      {/* Production Items */}
      <Card title={`Itens de Producao (${itens.length})`}>
        {itens.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Modelo</th>
                  <th className="text-left py-1">Molde</th>
                  <th className="text-left py-1">Personal.</th>
                  <th className="text-left py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-1 max-w-32 truncate">{item.modelo}</td>
                    <td className="py-1">{item.molde ?? '-'}</td>
                    <td className="py-1 max-w-32 truncate">{item.personalizacao ?? '-'}</td>
                    <td className="py-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs ${
                          item.status === 'produzido'
                            ? 'bg-green-100 text-green-700'
                            : item.status === 'erro'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Nenhum item</p>
        )}
      </Card>

      {/* Batch & Files */}
      <Card title="Lote & Arquivos">
        {lote ? (
          <>
            <Field label="Lote ID" value={lote.id.slice(0, 8)} />
            <Field label="Status" value={lote.status} />
            <Field label="Sucesso" value={lote.itens_sucesso} />
            <Field label="Erro" value={lote.itens_erro} />
            {lote.completed_at && (
              <Field
                label="Concluido"
                value={new Date(lote.completed_at).toLocaleString('pt-BR')}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400 mb-2">Nenhum lote</p>
        )}

        {arquivos.length > 0 && (
          <div className="mt-3 border-t pt-3 space-y-1">
            <p className="text-xs text-gray-500 font-medium">Arquivos ({arquivos.length})</p>
            {arquivos.map((file) => (
              <div key={file.id} className="flex items-center justify-between text-xs">
                <span className="truncate max-w-48">{file.nome_arquivo}</span>
                <a
                  href={`/api/arquivos/${file.id}/download`}
                  className="text-blue-600 hover:underline shrink-0 ml-2"
                >
                  Download
                </a>
              </div>
            ))}
          </div>
        )}

        {expedicao && (
          <div className="mt-3 border-t pt-3">
            <p className="text-xs text-gray-500 font-medium mb-1">Expedicao</p>
            <Field label="Tiny ID" value={expedicao.tiny_expedicao_id} />
            <Field label="Frete" value={expedicao.forma_frete} />
            <Field label="NFs" value={expedicao.nf_ids?.length ?? 0} />
          </div>
        )}
      </Card>
    </div>
  );
}

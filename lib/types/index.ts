// ============================================================
// Entity types matching data-model.md
// ============================================================

export type UserRole = 'admin' | 'operador' | 'expedicao';

export interface Usuario {
  id: string;
  username: string;
  password_hash: string;
  nome: string;
  role: UserRole;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export type PedidoStatus =
  | 'recebido'
  | 'aguardando_nf'
  | 'pronto_producao'
  | 'em_producao'
  | 'produzido'
  | 'expedido'
  | 'avulso_produzido'
  | 'erro_fiscal'
  | 'erro_enriquecimento'
  | 'erro_producao';

export type LinhaProduto = 'uniquebox' | 'uniquekids';

export interface Pedido {
  id: string;
  tiny_pedido_id: number;
  numero: number;
  data_pedido: string;
  id_pedido_ecommerce: string | null;
  id_contato: number | null;
  nome_ecommerce: string;
  linha_produto: LinhaProduto;
  status: PedidoStatus;
  nome_cliente: string | null;
  forma_frete: string | null;
  id_forma_envio: number | null;
  id_forma_frete: number | null;
  id_transportador: number | null;
  is_avulso: boolean;
  created_at: string;
  updated_at: string;
}

export interface PedidoWithCount extends Pedido {
  itens_count: number;
}

export interface NotaFiscal {
  id: string;
  pedido_id: string;
  tiny_nf_id: number | null;
  tiny_pedido_clone_id: number | null;
  numero_nf: number | null;
  modelo: string;
  autorizada: boolean;
  autorizada_at: string | null;
  created_at: string;
}

export type ItemProducaoStatus = 'pendente' | 'produzido' | 'erro';

export interface ItemProducao {
  id: string;
  pedido_id: string;
  lote_id: string | null;
  modelo: string;
  molde: string | null;
  fonte: string | null;
  personalizacao: string | null;
  has_personalizacao: boolean;
  tiny_nf_id: number | null;
  numero_nf: number | null;
  status: ItemProducaoStatus;
  erro_detalhe: string | null;
  created_at: string;
}

export type LoteStatus = 'processando' | 'concluido' | 'erro_parcial';

export interface LoteProducao {
  id: string;
  linha_produto: string;
  status: LoteStatus;
  total_itens: number;
  itens_sucesso: number;
  itens_erro: number;
  criado_por: string | null;
  created_at: string;
  completed_at: string | null;
}

export type ExpedicaoStatus = 'criada' | 'erro';

export interface Expedicao {
  id: string;
  lote_id: string | null;
  tiny_expedicao_id: number | null;
  forma_frete: string;
  id_forma_frete: number | null;
  id_transportador: number | null;
  nf_ids: number[];
  status: ExpedicaoStatus;
  erro_detalhe: string | null;
  created_at: string;
}

export type ArquivoTipo = 'svg' | 'pdf';

export interface Arquivo {
  id: string;
  lote_id: string;
  tipo: ArquivoTipo;
  nome_arquivo: string;
  storage_path: string;
  storage_bucket: string;
  tamanho_bytes: number | null;
  created_at: string;
}

export type TarefaStatus = 'pendente' | 'em_andamento' | 'concluido';

export interface Tarefa {
  id: string;
  lote_id: string;
  titulo: string;
  status: TarefaStatus;
  notas: string | null;
  atribuido_a: string | null;
  created_at: string;
  completed_at: string | null;
}

export type EventoTipo =
  | 'status_change'
  | 'file_generated'
  | 'expedicao_criada'
  | 'erro'
  | 'api_call';

export interface Evento {
  id: string;
  pedido_id: string | null;
  lote_id: string | null;
  tipo: string;
  descricao: string;
  dados: Record<string, unknown> | null;
  ator: string;
  created_at: string;
}

// ============================================================
// API response types
// ============================================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
  };
}

export interface PedidoDetail {
  pedido: Pedido;
  nota_fiscal: NotaFiscal | null;
  itens: ItemProducao[];
  lote: LoteProducao | null;
  expedicao: Expedicao | null;
  arquivos: Arquivo[];
  eventos: Evento[];
}

// ============================================================
// Auth types
// ============================================================

export interface JWTPayload {
  sub: string;
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface AuthUser {
  id: string;
  username: string;
  nome: string;
  role: UserRole;
}

export interface FotoBloco {
  id: string;
  item_id: string;
  posicao: number;
  shopify_url: string;
  storage_path: string | null;
  largura_px: number | null;
  altura_px: number | null;
  tamanho_bytes: number | null;
  content_type: string | null;
  status: 'pendente' | 'baixada' | 'erro';
  erro_detalhe: string | null;
  baixada_em: string | null;
  created_at: string;
  updated_at: string;
}

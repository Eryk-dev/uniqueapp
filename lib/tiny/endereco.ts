/**
 * Endereco de entrega do pedido do Tiny.
 *
 * O Tiny as vezes apaga `enderecoEntrega` e move o endereco pra
 * `observacoesInternas` no formato "Endereço original: rua, num, comp,
 * bairro, cidade - UF, CEP" (caso tipico: pedido com taxa adicional).
 * Por isso todo consumidor precisa do mesmo par primario + fallback.
 */

export interface EnderecoEntrega {
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
}

/**
 * Extrai "Endereço original: rua, num, comp, bairro, cidade - UF, CEP"
 * de observacoesInternas. Retorna null se nao encontrar.
 */
export function parseEnderecoFromObs(obs?: string): EnderecoEntrega | null {
  if (!obs) return null;
  const match = obs.match(/Endere[çc]o original:\s*([^\n\r]+)/i);
  if (!match) return null;

  const partes = match[1]!.split(",").map((s) => s.trim()).filter(Boolean);
  if (partes.length < 4) return null;

  // Heuristica: CEP eh o item que matchea \d{5}-?\d{3}; cidade-UF contem ' - '
  let cep = "";
  let municipio = "";
  let uf = "";
  const restantes: string[] = [];

  for (const p of partes) {
    if (/^\d{5}-?\d{3}$/.test(p) && !cep) {
      cep = p;
    } else if (/^.+\s-\s[A-Z]{2}$/.test(p) && !municipio) {
      const idx = p.lastIndexOf(" - ");
      municipio = p.slice(0, idx).trim();
      uf = p.slice(idx + 3).trim();
    } else {
      restantes.push(p);
    }
  }

  // Resto na ordem: endereco, numero, complemento, bairro
  const [endereco = "", numero = "", complemento = "", bairro = ""] = restantes;

  return { endereco, numero, complemento, bairro, municipio, uf, cep };
}

/** Endereco de entrega do pedido, com fallback pra observacoesInternas. */
export function resolveEnderecoEntrega(pedido: {
  enderecoEntrega?: Partial<EnderecoEntrega> | null;
  observacoesInternas?: string;
}): Partial<EnderecoEntrega> | null {
  return pedido.enderecoEntrega ?? parseEnderecoFromObs(pedido.observacoesInternas);
}

/** Cidade/UF do destinatario. `null` quando o Tiny nao devolve nenhum dos dois. */
export function extractCidadeUf(pedido: {
  enderecoEntrega?: Partial<EnderecoEntrega> | null;
  observacoesInternas?: string;
}): { cidade: string | null; uf: string | null } {
  const end = resolveEnderecoEntrega(pedido);
  return {
    cidade: end?.municipio?.trim() || null,
    uf: end?.uf?.trim() || null,
  };
}

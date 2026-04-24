// lib/shopify/orders.ts
import { shopifyGraphQL } from './client';
import { ShopifyApiError, type BlocoPhoto } from './types';

const ORDER_QUERY = `
  query GetOrderForBloco($id: ID!) {
    order(id: $id) {
      id
      name
      lineItems(first: 50) {
        edges {
          node {
            id
            sku
            quantity
            customAttributes {
              key
              value
            }
          }
        }
      }
    }
  }
`;

interface GraphQLOrderResponse {
  order: {
    id: string;
    name: string;
    lineItems: {
      edges: Array<{
        node: {
          id: string;
          sku: string | null;
          quantity: number;
          customAttributes: Array<{ key: string; value: string }>;
        };
      }>;
    };
  } | null;
}

/**
 * Converte um Shopify numeric order ID (ex: "6794997629172") para GID.
 */
function toOrderGid(numericId: string | number): string {
  return `gid://shopify/Order/${numericId}`;
}

/**
 * Extrai pares [posicao, url] de customAttributes olhando por chaves tipo "Foto 1", "Foto 2".
 * Ignora entries cuja key não bate com o pattern (ex: "Observação", "Nome").
 * Ignora quando o valor não parece URL válida.
 */
function parsePhotosFromCustomAttributes(
  attrs: Array<{ key: string; value: string }>
): Array<{ posicao: number; url: string }> {
  const pattern = /^Foto\s*(\d+)\s*:?\s*$/i;
  const photos: Array<{ posicao: number; url: string }> = [];

  for (const attr of attrs) {
    const match = attr.key.match(pattern);
    if (!match) continue;

    const posicao = parseInt(match[1]!, 10);
    if (!Number.isFinite(posicao) || posicao < 1) continue;

    const url = attr.value.trim();
    if (!/^https?:\/\//i.test(url)) continue;

    photos.push({ posicao, url });
  }

  // Sort determinístico por posição
  return photos.sort((a, b) => a.posicao - b.posicao);
}

/**
 * Busca fotos de bloco de um pedido Shopify.
 * Retorna lista plana [{lineItemId, sku, lineItemIndex, posicao, url}] ordenada por lineItemIndex, posicao.
 *
 * Se pedido não existir → lança ShopifyApiError(code='not_found').
 * Se nenhum line_item tiver "Foto N:" → retorna [] (sem erro; chamador decide se é erro de negócio).
 */
export async function fetchPhotosFromOrder(
  shopifyOrderNumericId: string | number
): Promise<BlocoPhoto[]> {
  const gid = toOrderGid(shopifyOrderNumericId);
  const data = await shopifyGraphQL<GraphQLOrderResponse>(ORDER_QUERY, { id: gid });

  if (!data.order) {
    throw new ShopifyApiError(
      `Shopify order not found: ${shopifyOrderNumericId}`,
      404,
      'not_found'
    );
  }

  const result: BlocoPhoto[] = [];
  const edges = data.order.lineItems.edges;

  edges.forEach((edge, lineItemIndex) => {
    const { id: lineItemId, sku, customAttributes } = edge.node;
    const photos = parsePhotosFromCustomAttributes(customAttributes);

    for (const photo of photos) {
      result.push({
        lineItemId,
        sku,
        lineItemIndex,
        posicao: photo.posicao,
        url: photo.url,
      });
    }
  });

  return result;
}

// Exported for unit testing
export const __internal = { parsePhotosFromCustomAttributes, toOrderGid };

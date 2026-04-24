// lib/shopify/types.ts

export interface ShopifyCustomAttribute {
  key: string;
  value: string;
}

export interface ShopifyLineItem {
  id: string;               // GID: gid://shopify/LineItem/1234
  sku: string | null;
  quantity: number;
  customAttributes: ShopifyCustomAttribute[];
  index?: number;           // populado por nós (não vem do Shopify) pra manter ordem original
}

export interface ShopifyOrder {
  id: string;               // GID: gid://shopify/Order/1234
  name: string;             // #1001
  lineItems: ShopifyLineItem[];
}

export interface BlocoPhoto {
  lineItemId: string;       // GID
  sku: string | null;
  lineItemIndex: number;    // posição na lista de line_items do pedido (0-based)
  posicao: number;          // N em "Foto N:"
  url: string;              // CDN URL original do Shopify
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: 'auth' | 'not_found' | 'rate_limit' | 'server_error' | 'unknown'
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}

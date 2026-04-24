// lib/shopify/client.ts
import { ShopifyApiError } from './types';

const API_VERSION = '2024-10';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getShopifyConfig(): { domain: string; token: string } {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain) throw new Error('Missing SHOPIFY_SHOP_DOMAIN env var');
  if (!token) throw new Error('Missing SHOPIFY_ADMIN_TOKEN env var');

  return { domain, token };
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

/**
 * Executa GraphQL query no Shopify Admin API.
 * Retry 3x com backoff exponencial para 5xx/429.
 * Lança ShopifyApiError com code apropriado em falhas permanentes.
 */
export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { domain, token } = getShopifyConfig();
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query, variables }),
      });

      // Permanent failures — no retry
      if (res.status === 401 || res.status === 403) {
        throw new ShopifyApiError(
          `Shopify auth failed (${res.status})`,
          res.status,
          'auth'
        );
      }
      if (res.status === 404) {
        throw new ShopifyApiError(
          `Shopify endpoint or resource not found`,
          res.status,
          'not_found'
        );
      }

      // Retryable failures
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : BASE_BACKOFF_MS * Math.pow(2, attempt);

        if (attempt < MAX_RETRIES) {
          await sleep(waitMs);
          continue;
        }

        throw new ShopifyApiError(
          `Shopify API failed after ${MAX_RETRIES} retries (${res.status})`,
          res.status,
          res.status === 429 ? 'rate_limit' : 'server_error'
        );
      }

      // Other 4xx — permanent
      if (!res.ok) {
        throw new ShopifyApiError(
          `Shopify API error (${res.status}): ${await res.text()}`,
          res.status,
          'unknown'
        );
      }

      const payload = (await res.json()) as GraphQLResponse<T>;

      if (payload.errors && payload.errors.length > 0) {
        throw new ShopifyApiError(
          `GraphQL errors: ${payload.errors.map((e) => e.message).join('; ')}`,
          200,
          'unknown'
        );
      }

      if (!payload.data) {
        throw new ShopifyApiError('GraphQL response missing data', 200, 'unknown');
      }

      return payload.data;
    } catch (err) {
      if (err instanceof ShopifyApiError && err.code !== 'rate_limit' && err.code !== 'server_error') {
        throw err; // permanent — stop retrying
      }
      lastError = err as Error;

      if (attempt < MAX_RETRIES) {
        await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
      }
    }
  }

  throw lastError ?? new Error('Shopify request failed');
}

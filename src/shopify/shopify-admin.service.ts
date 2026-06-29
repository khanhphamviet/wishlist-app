import { Injectable, Logger } from '@nestjs/common';
import { GraphQLClient, gql } from 'graphql-request';
import { ShopifyTokenService } from './shopify-token.service';

const WISHLIST_NAMESPACE = 'custom';
const WISHLIST_KEY = 'wishlist';

@Injectable()
export class ShopifyAdminService {
  private readonly logger = new Logger(ShopifyAdminService.name);
  private readonly client: GraphQLClient;

  constructor(private readonly tokenService: ShopifyTokenService) {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    if (!storeUrl) throw new Error('SHOPIFY_STORE_URL must be configured in .env');

    this.client = new GraphQLClient(`${storeUrl}/admin/api/2026-04/graphql.json`);
  }

  private async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = await this.tokenService.getToken();
    this.client.setHeader('X-Shopify-Access-Token', token);

    try {
      return await this.client.request<T>(query, variables);
    } catch (err: any) {
      if (err?.response?.status === 401) {
        const newToken = await this.tokenService.refreshToken();
        this.client.setHeader('X-Shopify-Access-Token', newToken);
        return await this.client.request<T>(query, variables);
      }
      throw err;
    }
  }

  /**
   * Returns the list of product IDs saved in the customer's wishlist metafield.
   * Returns [] if the customer has no wishlist metafield yet.
   */
  async getWishlistProductIds(customerGid: string): Promise<string[]> {
    const query = gql`
      query GetWishlist($customerId: ID!, $namespace: String!, $key: String!) {
        customer(id: $customerId) {
          metafield(namespace: $namespace, key: $key) {
            value
          }
        }
      }
    `;

    const data = await this.request<{
      customer: { metafield: { value: string } | null } | null;
    }>(query, {
      customerId: customerGid,
      namespace: WISHLIST_NAMESPACE,
      key: WISHLIST_KEY,
    });

    const rawValue = data.customer?.metafield?.value;
    if (!rawValue) return [];

    try {
      const parsed = JSON.parse(rawValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      this.logger.warn(`Failed to parse wishlist metafield: ${rawValue}`);
      return [];
    }
  }

  /**
   * Overwrites the customer's wishlist metafield with the given list of product IDs.
   */
  async setWishlistProductIds(customerGid: string, productIds: string[]): Promise<void> {
    const mutation = gql`
      mutation SetWishlist($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await this.request<{
      metafieldsSet: {
        userErrors: { field: string[]; message: string }[];
      };
    }>(mutation, {
      metafields: [
        {
          ownerId: customerGid,
          namespace: WISHLIST_NAMESPACE,
          key: WISHLIST_KEY,
          type: 'json',
          value: JSON.stringify(productIds),
        },
      ],
    });

    const errors = result.metafieldsSet.userErrors;
    if (errors?.length) {
      this.logger.error(`Failed to write metafield: ${JSON.stringify(errors)}`);
      throw new Error(errors.map((e) => e.message).join(', '));
    }
  }

  /**
   * Fetches display information (title, handle, image, price) for multiple products.
   */
  async getProductsByIds(productGids: string[]): Promise<
    {
      id: string;
      title: string;
      handle: string;
      image: string | null;
      price: string;
      currencyCode: string;
      url: string;
    }[]
  > {
    if (productGids.length === 0) return [];

    const query = gql`
      query GetProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            featuredImage {
              url
            }
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    `;

    const data = await this.request<{
      nodes: ({
        id: string;
        title: string;
        handle: string;
        featuredImage: { url: string } | null;
        priceRangeV2: {
          minVariantPrice: { amount: string; currencyCode: string };
        };
      } | null)[];
    }>(query, { ids: productGids });

    return data.nodes
      .filter((n) => n !== null)
      .map((n) => ({
        id: n.id,
        title: n.title,
        handle: n.handle,
        image: n.featuredImage?.url ?? null,
        price: n.priceRangeV2.minVariantPrice.amount,
        currencyCode: n.priceRangeV2.minVariantPrice.currencyCode,
        url: `/products/${n.handle}`,
      }));
  }
}

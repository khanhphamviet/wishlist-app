import { Injectable } from '@nestjs/common';
import { ShopifyAdminService } from '../shopify/shopify-admin.service';

@Injectable()
export class WishlistService {
  constructor(private readonly shopifyAdmin: ShopifyAdminService) {}

  /** Converts a numeric customer ID (from App Proxy) to a Shopify GID for GraphQL */
  private toCustomerGid(customerId: string): string {
    return `gid://shopify/Customer/${customerId}`;
  }

  /** Converts a numeric product ID to a Shopify GID */
  private toProductGid(productId: string): string {
    return `gid://shopify/Product/${productId}`;
  }

  /** Extracts the numeric ID from a Shopify GID (for frontend responses) */
  private fromGid(gid: string): string {
    return gid.split('/').pop() ?? gid;
  }

  async checkIsWishlisted(customerId: string, productId: string): Promise<boolean> {
    const ids = await this.shopifyAdmin.getWishlistProductIds(this.toCustomerGid(customerId));
    return ids.includes(this.toProductGid(productId));
  }

  /**
   * Toggles a product in the wishlist (removes it if present, adds it if not).
   * Returns the new state after the toggle.
   */
  async toggle(customerId: string, productId: string): Promise<{ isWishlisted: boolean }> {
    const customerGid = this.toCustomerGid(customerId);
    const productGid = this.toProductGid(productId);

    const currentIds = await this.shopifyAdmin.getWishlistProductIds(customerGid);

    const exists = currentIds.includes(productGid);
    const newIds = exists
      ? currentIds.filter((id) => id !== productGid)
      : [...currentIds, productGid];

    await this.shopifyAdmin.setWishlistProductIds(customerGid, newIds);

    return { isWishlisted: !exists };
  }

  /**
   * Returns full product details (title, image, price, url) for all items in the wishlist.
   */
  async list(customerId: string) {
    const customerGid = this.toCustomerGid(customerId);
    const productGids = await this.shopifyAdmin.getWishlistProductIds(customerGid);

    if (productGids.length === 0) {
      return { products: [] };
    }

    const products = await this.shopifyAdmin.getProductsByIds(productGids);

    return {
      products: products.map((p) => ({
        id: this.fromGid(p.id),
        title: p.title,
        handle: p.handle,
        image: p.image,
        price: p.price,
        currencyCode: p.currencyCode,
        url: p.url,
      })),
    };
  }
}

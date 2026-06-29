import { ShopifyAdminService } from './shopify-admin.service';

const mockRequest = jest.fn();

jest.mock('graphql-request', () => ({
  GraphQLClient: jest.fn().mockImplementation(() => ({ request: mockRequest })),
  gql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.raw.reduce((acc, str, i) => acc + str + (values[i] ?? ''), ''),
}));

describe('ShopifyAdminService', () => {
  let service: ShopifyAdminService;

  beforeEach(() => {
    process.env.SHOPIFY_STORE_URL = 'https://khazhjp.myshopify.com';
    process.env.SHOPIFY_ACCESS_TOKEN = 'shpat_test';
    mockRequest.mockReset();
    service = new ShopifyAdminService();
  });

  afterEach(() => {
    delete process.env.SHOPIFY_STORE_URL;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
  });

  describe('constructor', () => {
    it('throws if SHOPIFY_STORE_URL is missing', () => {
      delete process.env.SHOPIFY_STORE_URL;
      expect(() => new ShopifyAdminService()).toThrow('SHOPIFY_STORE_URL');
    });

    it('throws if SHOPIFY_ACCESS_TOKEN is missing', () => {
      delete process.env.SHOPIFY_ACCESS_TOKEN;
      expect(() => new ShopifyAdminService()).toThrow('SHOPIFY_ACCESS_TOKEN');
    });
  });

  describe('getWishlistProductIds', () => {
    it('returns product IDs from metafield', async () => {
      const ids = ['gid://shopify/Product/1', 'gid://shopify/Product/2'];
      mockRequest.mockResolvedValue({
        customer: { metafield: { value: JSON.stringify(ids) } },
      });

      const result = await service.getWishlistProductIds('gid://shopify/Customer/1');
      expect(result).toEqual(ids);
    });

    it('returns [] when customer has no metafield', async () => {
      mockRequest.mockResolvedValue({ customer: { metafield: null } });
      const result = await service.getWishlistProductIds('gid://shopify/Customer/1');
      expect(result).toEqual([]);
    });

    it('returns [] when customer is null', async () => {
      mockRequest.mockResolvedValue({ customer: null });
      const result = await service.getWishlistProductIds('gid://shopify/Customer/1');
      expect(result).toEqual([]);
    });

    it('returns [] when metafield value is invalid JSON', async () => {
      mockRequest.mockResolvedValue({
        customer: { metafield: { value: 'not-json' } },
      });
      const result = await service.getWishlistProductIds('gid://shopify/Customer/1');
      expect(result).toEqual([]);
    });

    it('returns [] when metafield value is not an array', async () => {
      mockRequest.mockResolvedValue({
        customer: { metafield: { value: JSON.stringify({ foo: 'bar' }) } },
      });
      const result = await service.getWishlistProductIds('gid://shopify/Customer/1');
      expect(result).toEqual([]);
    });
  });

  describe('setWishlistProductIds', () => {
    it('resolves successfully when no userErrors', async () => {
      mockRequest.mockResolvedValue({
        metafieldsSet: { userErrors: [] },
      });
      await expect(
        service.setWishlistProductIds('gid://shopify/Customer/1', ['gid://shopify/Product/1']),
      ).resolves.toBeUndefined();
    });

    it('throws when userErrors are returned', async () => {
      mockRequest.mockResolvedValue({
        metafieldsSet: { userErrors: [{ field: ['value'], message: 'Invalid value' }] },
      });
      await expect(
        service.setWishlistProductIds('gid://shopify/Customer/1', []),
      ).rejects.toThrow('Invalid value');
    });

    it('sends the correct product IDs as JSON', async () => {
      mockRequest.mockResolvedValue({ metafieldsSet: { userErrors: [] } });
      const ids = ['gid://shopify/Product/1', 'gid://shopify/Product/2'];
      await service.setWishlistProductIds('gid://shopify/Customer/1', ids);

      const [, variables] = mockRequest.mock.calls[0];
      expect(JSON.parse(variables.metafields[0].value)).toEqual(ids);
    });
  });

  describe('getProductsByIds', () => {
    it('returns [] immediately for empty input', async () => {
      const result = await service.getProductsByIds([]);
      expect(result).toEqual([]);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('maps product nodes to expected shape', async () => {
      mockRequest.mockResolvedValue({
        nodes: [
          {
            id: 'gid://shopify/Product/1',
            title: 'Test Product',
            handle: 'test-product',
            featuredImage: { url: 'https://cdn.shopify.com/img.jpg' },
            priceRangeV2: { minVariantPrice: { amount: '29.99', currencyCode: 'USD' } },
          },
        ],
      });

      const result = await service.getProductsByIds(['gid://shopify/Product/1']);
      expect(result).toEqual([
        {
          id: 'gid://shopify/Product/1',
          title: 'Test Product',
          handle: 'test-product',
          image: 'https://cdn.shopify.com/img.jpg',
          price: '29.99',
          currencyCode: 'USD',
          url: '/products/test-product',
        },
      ]);
    });

    it('sets image to null when featuredImage is missing', async () => {
      mockRequest.mockResolvedValue({
        nodes: [
          {
            id: 'gid://shopify/Product/2',
            title: 'No Image',
            handle: 'no-image',
            featuredImage: null,
            priceRangeV2: { minVariantPrice: { amount: '0.00', currencyCode: 'USD' } },
          },
        ],
      });

      const result = await service.getProductsByIds(['gid://shopify/Product/2']);
      expect(result[0].image).toBeNull();
    });

    it('filters out null nodes', async () => {
      mockRequest.mockResolvedValue({ nodes: [null, null] });
      const result = await service.getProductsByIds(['gid://shopify/Product/1', 'gid://shopify/Product/2']);
      expect(result).toEqual([]);
    });
  });
});

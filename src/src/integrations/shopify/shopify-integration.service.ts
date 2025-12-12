import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { CreateOrderFromChannelDto } from '@modules/orders/dto/create-order-from-channel.dto';

/**
 * Shopify Integration Service
 * 
 * Handles Shopify API integration including:
 * - Product sync
 * - Order sync and mapping
 * - Inventory sync
 * - Fulfillment creation
 * - Webhook registration
 */
@Injectable()
export class ShopifyIntegrationService {
  private readonly logger = new Logger(ShopifyIntegrationService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Sync products from Shopify
   * 
   * Fetches products from Shopify API and creates/updates internal Product and SKU records.
   * 
   * @param channelId - Channel ID
   * @param sinceTimestamp - Only sync products updated since this timestamp
   */
  async syncProductsForChannel(
    channelId: string,
    sinceTimestamp?: string,
  ): Promise<void> {
    this.logger.log(
      `Syncing products for channel ${channelId} since ${sinceTimestamp || 'beginning'}`,
    );

    // Get channel configuration
    const channel = await this.getChannel(channelId);
    const { shopDomain, accessToken } = this.extractCredentials(channel.config);

    // Build API URL
    const url = this.buildApiUrl(shopDomain, '/admin/api/2024-01/products.json', {
      updated_at_min: sinceTimestamp,
      limit: '250',
    });

    // Fetch products from Shopify
    const products = await this.httpGet(url, accessToken);

    this.logger.log(`Fetched ${products.length} products from Shopify`);

    // TODO: Map and save products
    // for (const shopifyProduct of products) {
    //   await this.mapAndSaveProduct(channelId, channel.organizationId, shopifyProduct);
    // }

    // Update last sync timestamp
    await this.updateChannelLastSync(channelId);
  }

  /**
   * Sync orders from Shopify
   * 
   * Fetches orders from Shopify API and creates internal Order records.
   * 
   * @param channelId - Channel ID
   * @param sinceTimestamp - Only sync orders created since this timestamp
   */
  async syncOrdersForChannel(
    channelId: string,
    sinceTimestamp?: string,
  ): Promise<void> {
    this.logger.log(
      `Syncing orders for channel ${channelId} since ${sinceTimestamp || 'beginning'}`,
    );

    // Get channel configuration
    const channel = await this.getChannel(channelId);
    const { shopDomain, accessToken } = this.extractCredentials(channel.config);

    // Build API URL
    const url = this.buildApiUrl(shopDomain, '/admin/api/2024-01/orders.json', {
      created_at_min: sinceTimestamp,
      status: 'any',
      limit: '250',
    });

    // Fetch orders from Shopify
    const orders = await this.httpGet(url, accessToken);

    this.logger.log(`Fetched ${orders.length} orders from Shopify`);

    // TODO: Process orders
    // for (const shopifyOrder of orders) {
    //   const orderDto = await this.mapExternalOrderToInternal(channelId, shopifyOrder);
    //   await ordersService.createOrUpdateOrderFromChannelPayload(
    //     orderDto,
    //     channel.organizationId,
    //     ActorType.SYSTEM,
    //   );
    // }

    // Update last sync timestamp
    await this.updateChannelLastSync(channelId);
  }

  /**
   * Map external Shopify order to internal DTO
   * 
   * Transforms Shopify order payload into CreateOrderFromChannelDto format.
   * 
   * @param channelId - Channel ID
   * @param externalOrder - Raw Shopify order payload
   * @returns Mapped order DTO
   */
  async mapExternalOrderToInternal(
    channelId: string,
    externalOrder: any,
  ): Promise<CreateOrderFromChannelDto> {
    this.logger.log(`Mapping Shopify order ${externalOrder.id} to internal format`);

    const channel = await this.getChannel(channelId);

    // Map customer
    const customer = {
      externalId: externalOrder.customer?.id?.toString() || externalOrder.id.toString(),
      firstName: externalOrder.customer?.first_name || externalOrder.shipping_address?.first_name || 'Guest',
      lastName: externalOrder.customer?.last_name || externalOrder.shipping_address?.last_name || 'Customer',
      email: externalOrder.customer?.email || externalOrder.email,
      phone: externalOrder.customer?.phone || externalOrder.phone,
      metadata: {
        shopify_customer_id: externalOrder.customer?.id,
      },
    };

    // Map shipping address
    const shippingAddress = externalOrder.shipping_address ? {
      firstName: externalOrder.shipping_address.first_name,
      lastName: externalOrder.shipping_address.last_name,
      company: externalOrder.shipping_address.company,
      street1: externalOrder.shipping_address.address1,
      street2: externalOrder.shipping_address.address2,
      city: externalOrder.shipping_address.city,
      state: externalOrder.shipping_address.province,
      postalCode: externalOrder.shipping_address.zip,
      country: externalOrder.shipping_address.country_code,
      phone: externalOrder.shipping_address.phone,
    } : {
      firstName: customer.firstName,
      lastName: customer.lastName,
      street1: 'No address provided',
      city: 'Unknown',
      postalCode: '00000',
      country: 'SA', // Default to Saudi Arabia
    };

    // Map billing address
    const billingAddress = externalOrder.billing_address ? {
      firstName: externalOrder.billing_address.first_name,
      lastName: externalOrder.billing_address.last_name,
      company: externalOrder.billing_address.company,
      street1: externalOrder.billing_address.address1,
      street2: externalOrder.billing_address.address2,
      city: externalOrder.billing_address.city,
      state: externalOrder.billing_address.province,
      postalCode: externalOrder.billing_address.zip,
      country: externalOrder.billing_address.country_code,
      phone: externalOrder.billing_address.phone,
    } : undefined;

    // Map line items
    const items = await Promise.all(
      externalOrder.line_items.map(async (item: any) => {
        // Find internal SKU by Shopify variant ID
        const sku = await this.findSkuByShopifyVariantId(item.variant_id, channel.organizationId);

        if (!sku) {
          this.logger.warn(
            `SKU not found for Shopify variant ${item.variant_id}. Order ${externalOrder.id} may fail to import.`,
          );
        }

        return {
          externalItemId: item.id.toString(),
          sku: sku?.sku || item.sku || `SHOPIFY-${item.variant_id}`,
          name: item.name,
          variantName: item.variant_title !== 'Default Title' ? item.variant_title : undefined,
          quantity: item.quantity,
          unitPrice: parseFloat(item.price),
          totalPrice: parseFloat(item.price) * item.quantity,
          taxAmount: item.tax_lines?.reduce((sum: number, tax: any) => sum + parseFloat(tax.price), 0) || 0,
          discountAmount: parseFloat(item.total_discount || '0'),
          metadata: {
            shopify_product_id: item.product_id,
            shopify_variant_id: item.variant_id,
          },
        };
      }),
    );

    // Map payment status
    const paymentStatus = this.mapShopifyFinancialStatus(externalOrder.financial_status);

    // Build order DTO
    const orderDto: CreateOrderFromChannelDto = {
      channelId,
      externalOrderId: externalOrder.id.toString(),
      orderNumber: externalOrder.order_number?.toString(),
      customer,
      shippingAddress,
      billingAddress,
      items,
      subtotal: parseFloat(externalOrder.subtotal_price),
      shippingCost: parseFloat(externalOrder.total_shipping_price_set?.shop_money?.amount || '0'),
      taxAmount: parseFloat(externalOrder.total_tax),
      discountAmount: parseFloat(externalOrder.total_discounts || '0'),
      totalAmount: parseFloat(externalOrder.total_price),
      currency: externalOrder.currency,
      paymentStatus,
      customerNote: externalOrder.note,
      tags: externalOrder.tags ? externalOrder.tags.split(', ') : [],
      metadata: {
        shopify_order_id: externalOrder.id,
        shopify_order_number: externalOrder.order_number,
        shopify_fulfillment_status: externalOrder.fulfillment_status,
        shopify_financial_status: externalOrder.financial_status,
        shopify_created_at: externalOrder.created_at,
      },
      orderDate: externalOrder.created_at,
    };

    this.logger.log(`Mapped Shopify order ${externalOrder.id} successfully`);

    return orderDto;
  }

  /**
   * Find SKU by Shopify variant ID
   */
  private async findSkuByShopifyVariantId(
    variantId: number,
    organizationId: string,
  ): Promise<{ sku: string } | null> {
    // TODO: Implement SKU lookup by Shopify variant ID
    // This requires storing Shopify variant ID in SKU metadata
    
    // const sku = await this.prisma.sKU.findFirst({
    //   where: {
    //     product: {
    //       organizationId,
    //     },
    //     metadata: {
    //       path: ['shopify_variant_id'],
    //       equals: variantId,
    //     },
    //   },
    //   select: { sku: true },
    // });
    
    // return sku;

    // Placeholder - return null for now
    return null;
  }

  /**
   * Map Shopify financial status to payment status
   */
  private mapShopifyFinancialStatus(financialStatus: string): any {
    const statusMap: Record<string, any> = {
      'pending': 'PENDING',
      'authorized': 'AUTHORIZED',
      'paid': 'PAID',
      'partially_paid': 'PENDING',
      'refunded': 'REFUNDED',
      'voided': 'FAILED',
      'partially_refunded': 'PARTIALLY_REFUNDED',
    };

    return statusMap[financialStatus] || 'PENDING';
  }

  /**
   * Get channel configuration
   */
  private async getChannel(channelId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    return channel;
  }

  /**
   * Extract credentials from channel config
   */
  private extractCredentials(config: any): { shopDomain: string; accessToken: string } {
    const shopDomain = config.shopDomain || config.shop_domain;
    const accessToken = config.accessToken || config.access_token;

    if (!shopDomain || !accessToken) {
      throw new Error('Missing Shopify credentials (shopDomain, accessToken)');
    }

    return { shopDomain, accessToken };
  }

  /**
   * Build Shopify API URL
   */
  private buildApiUrl(shopDomain: string, path: string, params?: Record<string, string>): string {
    const url = new URL(`https://${shopDomain}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value) {
          url.searchParams.append(key, value);
        }
      });
    }

    return url.toString();
  }

  /**
   * Update channel last sync timestamp
   */
  private async updateChannelLastSync(channelId: string): Promise<void> {
    await this.prisma.channel.update({
      where: { id: channelId },
      data: { lastSyncAt: new Date() },
    });
  }

  // ============================================================================
  // HTTP Methods (Stubs - implement with actual HTTP client)
  // ============================================================================

  /**
   * HTTP GET request
   * 
   * @param url - Full URL
   * @param accessToken - Shopify access token
   * @returns Response data
   * 
   * TODO: Implement with axios or node-fetch
   * Use ChannelConnection credentials from database
   */
  protected async httpGet(url: string, accessToken: string): Promise<any> {
    this.logger.debug(`GET ${url}`);
    
    // TODO: Implement actual HTTP request
    // const response = await axios.get(url, {
    //   headers: {
    //     'X-Shopify-Access-Token': accessToken,
    //     'Content-Type': 'application/json',
    //   },
    // });
    // return response.data.products || response.data.orders || response.data;

    throw new NotImplementedException('httpGet not implemented - use axios/fetch with Shopify credentials');
  }

  /**
   * HTTP POST request
   */
  protected async httpPost(url: string, accessToken: string, data: any): Promise<any> {
    this.logger.debug(`POST ${url}`);
    
    throw new NotImplementedException('httpPost not implemented');
  }

  /**
   * HTTP PUT request
   */
  protected async httpPut(url: string, accessToken: string, data: any): Promise<any> {
    this.logger.debug(`PUT ${url}`);
    
    throw new NotImplementedException('httpPut not implemented');
  }

  /**
   * HTTP DELETE request
   */
  protected async httpDelete(url: string, accessToken: string): Promise<any> {
    this.logger.debug(`DELETE ${url}`);
    
    throw new NotImplementedException('httpDelete not implemented');
  }
}

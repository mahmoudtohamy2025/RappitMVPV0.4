import { Module } from '@nestjs/common';
import { FedexService } from './fedex.service';
import { FedExIntegrationService } from '@integrations/shipping/fedex-integration.service';
import { IntegrationLoggingService } from '@services/integration-logging.service';
import { PrismaService } from '@common/database/prisma.service';

/**
 * FedEx Module
 * 
 * Provides FedEx shipping integration with both high-level API (FedexService)
 * and low-level integration service (FedExIntegrationService).
 */
@Module({
  providers: [
    FedexService,
    FedExIntegrationService,
    IntegrationLoggingService,
    PrismaService,
  ],
  exports: [FedexService, FedExIntegrationService],
})
export class FedexModule {}

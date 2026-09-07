import { Module } from '@nestjs/common';
import { DomainVerificationService } from './domain-verification.service';
import { DomainsController } from './domains.controller';
import { AdminPrismaService } from '../admin-prisma.service';

@Module({
  controllers: [DomainsController],
  providers: [DomainVerificationService, AdminPrismaService],
  exports: [DomainVerificationService],
})
export class DomainsModule {}

import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { AdminPrismaService } from '../admin-prisma.service';

@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, AdminPrismaService],
  exports: [CompaniesService],
})
export class CompaniesModule {}

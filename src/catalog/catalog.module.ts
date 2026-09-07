import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { ScopedPrismaService } from '../scoped-prisma.service';

@Module({
  controllers: [CatalogController],
  providers: [ScopedPrismaService],
})
export class CatalogModule {}

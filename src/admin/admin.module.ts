import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { ScopedPrismaService } from '../scoped-prisma.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, ScopedPrismaService],
  exports: [AdminService],
})
export class AdminModule {}

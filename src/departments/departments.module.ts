import { Module } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { DepartmentsController } from './departments.controller';
import { ScopedPrismaService } from '../scoped-prisma.service';

@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService, ScopedPrismaService],
  exports: [DepartmentsService],
})
export class DepartmentsModule {}

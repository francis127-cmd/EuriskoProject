import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { PrismaService } from '../prisma.service';
import { DepartmentsModule } from '../departments/departments.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DepartmentsModule, AuthModule],
  controllers: [RequestsController],
  providers: [RequestsService, PrismaService],
  exports: [RequestsService],
})
export class RequestsModule {}

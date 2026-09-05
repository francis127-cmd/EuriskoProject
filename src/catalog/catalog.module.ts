import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { DepartmentsModule } from '../departments/departments.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DepartmentsModule, AuthModule],
  controllers: [CatalogController],
})
export class CatalogModule {}

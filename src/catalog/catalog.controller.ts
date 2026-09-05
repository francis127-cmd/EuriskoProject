import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { DepartmentsService } from '../departments/departments.service';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all active departments with their request types' })
  list() {
    return this.departmentsService.listActive();
  }
}

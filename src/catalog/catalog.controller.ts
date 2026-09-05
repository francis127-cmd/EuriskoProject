import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { DepartmentsService } from '../departments/departments.service';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all active departments with their request types' })
  list(@CurrentUser() user: AuthUser) {
    return this.departmentsService.listActive(user.companyId);
  }
}

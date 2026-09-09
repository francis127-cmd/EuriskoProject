import { Controller, Get } from '@nestjs/common';
import { ScopedPrismaService } from '../scoped-prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly prisma: ScopedPrismaService) {}

  @Get()
  async getCatalog(@CurrentUser() user: AuthUser) {
    const departments = await this.prisma.department.findMany({
      where: { active: true, companyId: user.companyId },
      include: { requestTypes: true },
      orderBy: { name: 'asc' },
    });
    return departments;
  }
}

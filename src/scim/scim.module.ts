import { Module } from '@nestjs/common';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';
import { AdminPrismaService } from '../admin-prisma.service';
import { AuthService } from '../auth/auth.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env['JWT_SECRET'],
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [ScimController],
  providers: [ScimService, AdminPrismaService, AuthService],
  exports: [ScimService],
})
export class ScimModule {}

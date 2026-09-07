import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { InvitationService } from './invitation.service';
import { InvitationController } from './invitation.controller';
import { JwtGuard } from './jwt.guard';
import { RolesGuard } from './roles.guard';
import { AdminPrismaService } from '../admin-prisma.service';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env['JWT_SECRET'],
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController, InvitationController],
  providers: [
    AuthService,
    InvitationService,
    AdminPrismaService,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, JwtModule, AdminPrismaService],
})
export class AuthModule {}

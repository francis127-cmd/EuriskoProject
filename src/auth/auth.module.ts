import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { InvitationService } from './invitation.service';
import { InvitationController } from './invitation.controller';
import { RefreshTokenService } from './refresh-token.service';
import { MfaService } from './mfa.service';
import { OidcFederationService } from './oidc-federation.service';
import { OidcFederationController } from './oidc-federation.controller';
import { OidcController } from './oidc.controller';
import { JwtGuard } from './jwt.guard';
import { RolesGuard } from './roles.guard';
import { AdminPrismaService } from '../admin-prisma.service';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env['JWT_SECRET'],
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController, InvitationController, OidcFederationController, OidcController],
  providers: [
    AuthService,
    InvitationService,
    RefreshTokenService,
    MfaService,
    OidcFederationService,
    AdminPrismaService,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, JwtModule, AdminPrismaService, RefreshTokenService, MfaService, OidcFederationService],
})
export class AuthModule {}

import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma.service';
import { InvitationService } from './invitation.service';
import { InvitationController } from './invitation.controller';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'],
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController, InvitationController],
  providers: [AuthService, PrismaService, InvitationService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

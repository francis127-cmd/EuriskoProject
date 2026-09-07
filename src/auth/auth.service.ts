import { Injectable, UnauthorizedException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { AdminPrismaService } from '../admin-prisma.service';

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  role: string;
  companyId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly jwtService: JwtService,
  ) {
    this.googleClient = new OAuth2Client(process.env['GOOGLE_CLIENT_ID']);
  }

  async discover(email: string) {
    const user = await this.prisma.user.findFirst({ where: { email } });
    if (!user) {
      return { authMode: 'REGISTER' };
    }
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId } });
    if (!company) {
      return { authMode: 'REGISTER' };
    }
    return {
      authMode: company.authMode || 'PASSWORD',
      companySlug: company.slug,
      companyName: company.name,
      companyId: company.id,
      provider: company.ssoProvider,
      googleClientId: company.googleClientId,
    };
  }

  async loginPassword(email: string, password: string) {
    const user = await this.prisma.user.findFirst({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.active) {
      throw new UnauthorizedException('Account deactivated');
    }
    const token = this.signToken(user);
    return { accessToken: token };
  }

  async registerPassword(dto: {
    email: string;
    password: string;
    displayName?: string;
    companyName?: string;
    companySlug?: string;
  }) {
    const existing = await this.prisma.user.findFirst({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    let companyId: string;
    let newCompany = false;

    if (dto.companySlug) {
      const company = await this.prisma.company.findUnique({ where: { slug: dto.companySlug } });
      if (!company) {
        throw new BadRequestException('Company not found');
      }
      companyId = company.id;
    } else if (dto.companyName) {
      const slug = dto.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existingCompany = await this.prisma.company.findUnique({ where: { slug } });
      if (existingCompany) {
        throw new ConflictException('Company slug already taken');
      }
      const company = await this.prisma.company.create({
        data: {
          name: dto.companyName,
          slug,
          authMode: 'PASSWORD',
        },
      });
      companyId = company.id;
      newCompany = true;
    } else {
      throw new BadRequestException('Either companyName or companySlug is required');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        companyId,
        email: dto.email,
        displayName: dto.displayName || dto.email.split('@')[0],
        passwordHash,
        platformRole: 'SYSTEM_ADMIN',
      },
    });

    const token = this.signToken(user);
    return { accessToken: token, newCompany };
  }

  async loginGoogle(idToken: string) {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: process.env['GOOGLE_CLIENT_ID'],
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: payload.email },
    });

    if (!user) {
      throw new UnauthorizedException('No account found. Please register first.');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account deactivated');
    }

    const token = this.signToken(user);
    return { accessToken: token, newCompany: false };
  }

  async acceptInvite(token: string, password: string) {
    const invitation = await this.prisma.invitation.findFirst({ where: { token } });
    if (!invitation) {
      throw new BadRequestException('Invalid invitation token');
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    const existing = await this.prisma.user.findFirst({
      where: { email: invitation.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        companyId: invitation.companyId,
        email: invitation.email,
        displayName: invitation.email.split('@')[0],
        passwordHash,
        platformRole: invitation.platformRole,
      },
    });

    if (invitation.departmentCode) {
      const dept = await this.prisma.department.findFirst({
        where: {
          companyId: invitation.companyId,
          code: invitation.departmentCode,
        },
      });
      if (dept && invitation.departmentRole) {
        await this.prisma.departmentMember.create({
          data: {
            departmentId: dept.id,
            userId: user.id,
            departmentRole: invitation.departmentRole,
          },
        });
      }
    }

    await this.prisma.invitation.delete({ where: { id: invitation.id } });

    const jwtToken = this.signToken(user);
    return { accessToken: jwtToken };
  }

  async validateInviteToken(token: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { token },
    });
    if (!invitation) {
      throw new BadRequestException('Invalid invitation token');
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }
    const company = await this.prisma.company.findUnique({ where: { id: invitation.companyId } });
    return {
      email: invitation.email,
      role: invitation.platformRole,
      department: invitation.departmentCode,
      companyName: company?.name || 'Unknown',
      companySlug: company?.slug || 'unknown',
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async verifyToken(token: string): Promise<AuthUser> {
    try {
      const payload = await this.jwtService.verifyAsync<AuthUser>(token);
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private signToken(user: { id: string; email: string; displayName: string; platformRole: string; companyId: string }): string {
    const payload: AuthUser = {
      sub: user.id,
      email: user.email,
      name: user.displayName,
      role: user.platformRole,
      companyId: user.companyId,
    };
    return this.jwtService.sign(payload);
  }
}

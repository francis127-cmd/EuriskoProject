import { Injectable, Logger } from '@nestjs/common';
import { AdminPrismaService } from '../admin-prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class ScimService {
  private readonly logger = new Logger(ScimService.name);

  constructor(
    private readonly prisma: AdminPrismaService,
    private readonly authService: AuthService,
  ) {}

  getSchemas() {
    return {
      schemas: [
        'urn:ietf:params:scim:schemas:core:2.0:Schema',
        'urn:ietf:params:scim:schemas:core:2.0:User',
        'urn:ietf:params:scim:schemas:core:2.0:Group',
        'urn:ietf:params:scim:api:messages:2.0:ListResponse',
        'urn:ietf:params:scim:api:messages:2.0:Error',
        'urn:ietf:params:scim:api:messages:2.0:PatchOp',
      ],
      meta: {
        resourceType: 'Schemas',
      },
    };
  }

  getServiceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: false, maxResults: 0 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      meta: {
        resourceType: 'ServiceProviderConfig',
      },
    };
  }

  getResourceTypes() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          description: 'User Account',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
          schemaExtensions: [],
        },
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'Group',
          name: 'Group',
          endpoint: '/Groups',
          description: 'Group',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
          schemaExtensions: [],
        },
      ],
    };
  }

  async listUsers(token: string) {
    try {
      const authUser = await this.authService.verifyToken(token);
      const users = await this.prisma.user.findMany({
        where: { companyId: authUser.companyId },
        select: {
          id: true,
          email: true,
          displayName: true,
          platformRole: true,
          active: true,
          createdAt: true,
        },
      });

      return {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: users.length,
        startIndex: 1,
        itemsPerPage: users.length,
        Resources: users.map((u) => this.toScimUser(u)),
      };
    } catch {
      return { scimType: 'invalidBearer', detail: 'Token validation failed' };
    }
  }

  async getUser(id: string, token: string) {
    try {
      const authUser = await this.authService.verifyToken(token);
      const user = await this.prisma.user.findFirst({
        where: { id, companyId: authUser.companyId },
      });
      if (!user) return null;
      return this.toScimUser(user);
    } catch {
      return null;
    }
  }

  async createUser(body: any, token: string) {
    try {
      const authUser = await this.authService.verifyToken(token);
      const userName = body.userName;
      const displayName =
        body.name?.givenName
          ? `${body.name.givenName} ${body.name.familyName || ''}`.trim()
          : userName;

      const user = await this.prisma.user.create({
        data: {
          companyId: authUser.companyId,
          email: userName,
          displayName,
          platformRole: 'EMPLOYEE',
          active: true,
        },
      });

      this.logger.log(`SCIM user created: ${user.email} for company ${authUser.companyId}`);
      return this.toScimUser(user);
    } catch (e: any) {
      return {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        scimType: 'invalidValue',
        detail: e.message || 'Failed to create user',
      };
    }
  }

  async updateUser(id: string, body: any, token: string) {
    try {
      const authUser = await this.authService.verifyToken(token);
      const data: any = {};

      if (body.active !== undefined) data.active = body.active;
      if (body.name?.givenName) {
        data.displayName = `${body.name.givenName} ${body.name.familyName || ''}`.trim();
      }

      const user = await this.prisma.user.update({
        where: { id },
        data,
      });

      this.logger.log(`SCIM user updated: ${user.email}`);
      return this.toScimUser(user);
    } catch (e: any) {
      return {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        scimType: 'invalidValue',
        detail: e.message || 'Failed to update user',
      };
    }
  }

  async deleteUser(id: string, token: string) {
    try {
      const authUser = await this.authService.verifyToken(token);
      await this.prisma.user.update({
        where: { id },
        data: { active: false },
      });
      this.logger.log(`SCIM user deactivated: ${id} for company ${authUser.companyId}`);
    } catch (e: any) {
      this.logger.error(`SCIM delete failed: ${e.message}`);
    }
  }

  private toScimUser(user: any) {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: user.id,
      externalId: user.email,
      userName: user.email,
      name: {
        givenName: user.displayName?.split(' ')[0] || '',
        familyName: user.displayName?.split(' ').slice(1).join(' ') || '',
      },
      displayName: user.displayName,
      active: user.active,
      emails: [{ value: user.email, type: 'work', primary: true }],
      roles: [
        {
          value: user.platformRole,
          display: user.platformRole === 'SYSTEM_ADMIN' ? 'Administrator' : 'User',
          primary: true,
        },
      ],
      meta: {
        resourceType: 'User',
      },
    };
  }
}

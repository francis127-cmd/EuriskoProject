import { Controller, Get, Post, Patch, Delete, Body, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ScimService } from './scim.service';
import { ScimGroupService } from './scim-group.service';

@Controller('scim/v2')
@Public()
export class ScimController {
  constructor(
    private readonly scimService: ScimService,
    private readonly scimGroupService: ScimGroupService,
  ) {}

  @Get('Schemas')
  getSchemas() {
    return this.scimService.getSchemas();
  }

  @Get('ServiceProviderConfig')
  getServiceProviderConfig() {
    return this.scimService.getServiceProviderConfig();
  }

  @Get('ResourceTypes')
  getResourceTypes() {
    return this.scimService.getResourceTypes();
  }

  @Get('Users')
  listUsers(@Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimService.listUsers(authHeader.slice(7));
  }

  @Get('Users/:id')
  getUser(@Param('id') id: string, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimService.getUser(id, authHeader.slice(7));
  }

  @Post('Users')
  @HttpCode(HttpStatus.CREATED)
  createUser(@Body() body: any, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimService.createUser(body, authHeader.slice(7));
  }

  @Patch('Users/:id')
  updateUser(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimService.updateUser(id, body, authHeader.slice(7));
  }

  @Delete('Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@Param('id') id: string, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimService.deleteUser(id, authHeader.slice(7));
  }

  @Get('Groups')
  listGroups(@Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimGroupService.listGroups('');
  }

  @Get('Groups/:id')
  getGroup(@Param('id') id: string, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimGroupService.getGroup(id, '');
  }

  @Post('Groups')
  @HttpCode(HttpStatus.CREATED)
  createGroup(@Body() body: any, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimGroupService.createGroup(body, '');
  }

  @Patch('Groups/:id')
  updateGroup(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimGroupService.updateGroup(id, body, '');
  }

  @Delete('Groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteGroup(@Param('id') id: string, @Req() req: any) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return { scimType: 'invalidBearer', detail: 'Valid authorization token required' };
    }
    return this.scimGroupService.deleteGroup(id, '');
  }
}

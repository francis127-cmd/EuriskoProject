import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator';

@Public()
@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get()
  root() {
    return { message: 'Internal Operations Hub API', status: 'online' };
  }
}

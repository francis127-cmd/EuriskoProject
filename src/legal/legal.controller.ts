import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from './legal-docs';

@Public()
@Controller('legal')
export class LegalController {
  @Get('privacy')
  privacy() {
    return PRIVACY_POLICY;
  }

  @Get('terms')
  terms() {
    return TERMS_OF_SERVICE;
  }
}

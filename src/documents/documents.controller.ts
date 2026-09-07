import { Controller, Get, Post, Delete, Param, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { Response } from 'express';

@Controller('requests')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post(':requestId/document')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('requestId') requestId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.upload(requestId, file, user);
  }

  @Get(':requestId/document')
  async download(
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const doc = await this.documentsService.download(requestId, user);
    res.set({
      'Content-Type': doc.contentType,
      'Content-Disposition': `attachment; filename="${doc.filename}"`,
      'X-Checksum': doc.checksum,
    });
    return res.send(doc.content);
  }

  @Delete(':requestId/document')
  async remove(
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documentsService.remove(requestId, user);
  }
}

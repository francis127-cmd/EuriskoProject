import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { DocumentsService } from './documents.service';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('requests')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post(':id/document')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document (.pdf/.png/.jpg/.jpeg, max 5MB)' })
  upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: AuthUser; file?: Express.Multer.File },
  ) {
    if (!req.file) throw new NotFoundException('No file provided');
    return this.documents.upload(id, req.file, req.user);
  }

  @Get(':id/document')
  @ApiOperation({ summary: 'Download the attached document' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.documents.download(id, user);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('X-Checksum', doc.checksum);
    return new StreamableFile(doc.content);
  }

  @Delete(':id/document')
  @ApiOperation({ summary: 'Delete the attached document (dept staff or admin)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.documents.remove(id, user);
  }
}

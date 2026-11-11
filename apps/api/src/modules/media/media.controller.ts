import { Controller, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { isTenantBlocked } from '../../common/util/tenant-status.util';
import { PrismaService } from '../../prisma/prisma.service';

// Images of the public menu, by id. Public like the menu itself; an image of a suspended
// restaurant is not served (its menu is not either). A row is never rewritten (a new image is a
// new id), so the browser may keep it for a year and only ever asks again with If-None-Match.
//
// Its own rate limit: one menu page shows dozens of photos at once, far over the global 100 per
// minute of a client, but every image is still a database read, so it is not unlimited.
@ApiTags('public-menu')
@Public()
@Throttle({ default: { limit: 1000, ttl: 60_000 } })
@Controller('public/media')
export class MediaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Imagem do cardápio público (logo, capa, produto ou adicional)' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    const meta = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: { contentType: true, sha256: true, tenant: { select: { status: true } } },
    });
    if (!meta || isTenantBlocked(meta.tenant.status)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Imagem não encontrada.' });
    }
    const etag = `"${meta.sha256}"`;
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      // An image never runs anything, even when opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    // The browser already has these bytes: no need to read them from the database.
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }
    const { data } = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id }, select: { data: true } });
    res.set({ 'Content-Type': meta.contentType, 'Content-Length': String(data.length) });
    res.end(Buffer.from(data));
  }
}

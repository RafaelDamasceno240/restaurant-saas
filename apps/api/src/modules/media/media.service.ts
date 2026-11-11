import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { checkImage } from './media-content';

type Db = PrismaService | Prisma.TransactionClient;

// The bytes of an upload, as the multipart parser hands them over. Only the bytes count: the file
// name and the declared type come from the client and are never trusted.
export interface UploadedImage {
  buffer: Buffer;
}

// Stores images sent from the panel (product photo, logo, cover) in media_assets, the same table
// the menu importer fills. The same picture is stored once per restaurant (content-addressed by
// sha256): sending it again returns the row that already exists. A row is never rewritten, so
// GET /public/media/:id can keep its one-year immutable cache.
@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  async storeImage(
    tenantId: string,
    file: UploadedImage | undefined,
    db: Db = this.prisma,
  ): Promise<string> {
    if (!file?.buffer?.length) {
      throw new BadRequestException({
        code: 'IMAGE_REQUIRED',
        message: 'Escolha uma imagem para enviar (campo "file").',
      });
    }
    const check = checkImage(file.buffer);
    if (!check.ok) {
      throw new BadRequestException({
        code: 'IMAGE_INVALID',
        message: `Imagem recusada: ${check.reason}. Envie JPEG, PNG ou WebP de até 3 MB.`,
      });
    }
    const existing = await db.mediaAsset.findUnique({
      where: { tenantId_sha256: { tenantId, sha256: check.sha256 } },
      select: { id: true },
    });
    if (existing) return existing.id;
    try {
      const created = await db.mediaAsset.create({
        data: {
          tenantId,
          contentType: check.contentType,
          sizeBytes: check.sizeBytes,
          sha256: check.sha256,
          data: file.buffer,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      // Two uploads of the same picture at once: the other one stored it first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await db.mediaAsset.findUniqueOrThrow({
          where: { tenantId_sha256: { tenantId, sha256: check.sha256 } },
          select: { id: true },
        });
        return again.id;
      }
      throw error;
    }
  }
}

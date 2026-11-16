import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { MAX_MEDIA_BYTES } from './media-content';

// One image per request, in the multipart field "file", kept in memory (never on disk) and cut
// off by the parser itself past 3 MiB, so an oversized upload is refused before it is read whole.
// No other field is accepted. Whether it really is an image is decided afterwards from its bytes
// (MediaService.storeImage), never from the name or the declared type.
const MulterImage = FileInterceptor('file', {
  limits: { fileSize: MAX_MEDIA_BYTES, files: 1, fields: 0 },
});

// The multer errors are English ("File too large", "Unexpected field"): they become the API's
// Portuguese messages, with their own codes.
@Injectable()
export class ImageUploadInterceptor implements NestInterceptor {
  private readonly inner = new MulterImage();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.inner.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new PayloadTooLargeException({
          code: 'IMAGE_TOO_LARGE',
          message: 'A imagem passa de 3 MB. Reduza o tamanho e envie de novo.',
        });
      }
      if (error instanceof HttpException && error.getStatus() === 400) {
        throw new BadRequestException({
          code: 'IMAGE_UPLOAD_INVALID',
          message: 'Envie um único arquivo de imagem, no campo "file" (multipart/form-data).',
        });
      }
      throw error;
    }
  }
}

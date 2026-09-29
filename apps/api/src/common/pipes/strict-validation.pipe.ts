import { ArgumentMetadata, Injectable, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_EXTRA_FIELDS_KEY } from '../decorators/allow-extra-fields.decorator';

// Global pipe. A plain `app.useGlobalPipes(new ValidationPipe(...))` plus a
// route-level `@UsePipes()` override doesn't work here: Nest runs pipes as a
// chain (global -> controller -> method -> param), so the global pipe's
// forbidNonWhitelisted:true already throws before any route-level override
// gets a turn. Reading metadata off the DTO class (set via
// @AllowExtraFields()) is what actually lets one route opt out.
@Injectable()
export class StrictValidationPipe extends ValidationPipe {
  constructor(private readonly reflector: Reflector) {
    super({
      whitelist: true, // strips unknown properties -> mitigates mass assignment
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: 400,
    });
  }

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const allowsExtraFields =
      !!metadata.metatype && this.reflector.get<boolean>(ALLOW_EXTRA_FIELDS_KEY, metadata.metatype);

    if (!allowsExtraFields) {
      return super.transform(value, metadata);
    }

    const lenient = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      errorHttpStatusCode: 400,
    });
    return lenient.transform(value, metadata);
  }
}

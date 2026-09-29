import { SetMetadata } from '@nestjs/common';

export const ALLOW_EXTRA_FIELDS_KEY = 'allowExtraFields';

// Marks a DTO class as tolerant of unknown properties: StrictValidationPipe
// still strips them (whitelist), but won't turn their mere presence into a
// 400 (forbidNonWhitelisted). For public/guest endpoints where a client
// tampering attempt (e.g. a smuggled price) must be silently ignored rather
// than rejected — every other DTO keeps the strict, reject-on-unknown default.
export const AllowExtraFields = () => SetMetadata(ALLOW_EXTRA_FIELDS_KEY, true);

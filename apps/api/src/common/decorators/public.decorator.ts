import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route as not requiring authentication. Everything is protected by
// default (JwtAuthGuard is global) — this is the explicit opt-out.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

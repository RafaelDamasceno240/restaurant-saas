import { NestExpressApplication } from '@nestjs/platform-express';

// How many reverse proxies stand between the internet and this process
// (TRUST_PROXY_HOPS). Express then takes the client address from that many
// entries back in X-Forwarded-For instead of from the socket, which is what
// the rate limiter, the audit log and refresh_tokens.ip record.
//
// A number, never `true`: trusting the whole header would let any caller
// pick its own address — and with it a fresh rate-limit bucket per request.
// 0 (the default) trusts nothing, which is right when nothing sits in front.
export function applyTrustProxy(app: NestExpressApplication, hops: number): void {
  app.set('trust proxy', hops);
}

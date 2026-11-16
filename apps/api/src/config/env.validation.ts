import { z } from 'zod';

// The application MUST fail fast at bootstrap if a required variable is
// missing or malformed — see docs/architecture.md, section "Configuração".
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Reverse proxies in front of the API whose X-Forwarded-For entry is
  // trusted (see common/http/trust-proxy.ts). 0 = none, the local default.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  // Public address of the web app: the base of the checkout links the WhatsApp assistant sends.
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),

  // WhatsApp assistant (modules/whatsapp). Everything is optional: without the Meta secrets the
  // webhook refuses deliveries, and without WHATSAPP_CLOUD_ENABLED=true nothing is ever sent to
  // the Cloud API (simulated connections only).
  WHATSAPP_APP_SECRET: z.string().min(16).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16).optional(),
  WHATSAPP_CLOUD_ENABLED: z.enum(['true', 'false']).default('false'),
  WHATSAPP_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  // base64 of 32 bytes; encrypts the Cloud API access tokens at rest.
  WHATSAPP_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  // The in-process queue worker. Off in the e2e suites, which drain the queue themselves.
  WHATSAPP_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
  // "local": the rule-based assistant (no cost, no network). "anthropic": Claude through the
  // official SDK; needs ANTHROPIC_API_KEY (read by the SDK itself, never logged).
  WHATSAPP_AI_PROVIDER: z.enum(['local', 'anthropic']).default('local'),
  WHATSAPP_AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
  WHATSAPP_AI_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  WHATSAPP_AI_MAX_TOKENS: z.coerce.number().int().min(256).max(16000).default(2048),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Thrown synchronously during ConfigModule bootstrap -> process exits.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

import { EnvConfig } from './env.validation';

export interface AppConfig {
  env: EnvConfig['NODE_ENV'];
  port: number;
  corsOrigin: string;
  trustProxyHops: number;
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  publicWebUrl: string;
  whatsapp: {
    appSecret: string | null;
    verifyToken: string | null;
    cloudEnabled: boolean;
    graphApiVersion: string;
    tokenEncryptionKey: string | null;
    workerEnabled: boolean;
    ai: {
      provider: 'local' | 'anthropic';
      model: string;
      effort: 'low' | 'medium' | 'high';
      maxTokens: number;
    };
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
}

export default (): AppConfig => {
  const env = process.env as unknown as EnvConfig;
  return {
    env: env.NODE_ENV,
    port: Number(env.PORT),
    corsOrigin: env.CORS_ORIGIN,
    trustProxyHops: Number(env.TRUST_PROXY_HOPS) || 0,
    database: { url: env.DATABASE_URL },
    redis: { url: env.REDIS_URL },
    publicWebUrl: env.PUBLIC_WEB_URL.replace(/\/+$/, ''),
    whatsapp: {
      appSecret: env.WHATSAPP_APP_SECRET ?? null,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? null,
      cloudEnabled: env.WHATSAPP_CLOUD_ENABLED === 'true',
      graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
      tokenEncryptionKey: env.WHATSAPP_TOKEN_ENCRYPTION_KEY ?? null,
      workerEnabled: env.WHATSAPP_WORKER_ENABLED === 'true',
      ai: {
        provider: env.WHATSAPP_AI_PROVIDER,
        model: env.WHATSAPP_AI_MODEL,
        effort: env.WHATSAPP_AI_EFFORT,
        maxTokens: Number(env.WHATSAPP_AI_MAX_TOKENS),
      },
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
  };
};

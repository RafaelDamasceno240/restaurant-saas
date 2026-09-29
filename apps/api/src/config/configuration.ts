import { EnvConfig } from './env.validation';

export interface AppConfig {
  env: EnvConfig['NODE_ENV'];
  port: number;
  corsOrigin: string;
  database: {
    url: string;
  };
  redis: {
    url: string;
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
    database: { url: env.DATABASE_URL },
    redis: { url: env.REDIS_URL },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },
  };
};

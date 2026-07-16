/**
 * 環境変数のバリデーション定義。
 * アプリケーション起動時に必要な環境変数が存在し、正しい形式であることを保証する。
 */
import { z } from 'zod';
import { logger } from '../utils/logger';

const envSchema = z.object({
  DATABASE_URL: z.url(),
  WEBHOOK_SECRET: z.string().min(1),
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.string().default('6379').transform(Number),
  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

export const validateEnv = () => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    logger.error({ err: result.error }, 'Invalid environment variables');
    process.exit(1);
  }
  return result.data;
};

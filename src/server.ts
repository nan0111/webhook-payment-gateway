/**
 * サーバーのエントリーポイント。
 * HTTPサーバーを起動し、SIGTERMシグナル受信時にリソースを解放して正常終了する。
 */
import app, { checkConnections } from './app';
import dotenv from 'dotenv';
import { validateEnv } from './config/env';
import prisma from './config/prisma';
import { logger } from './utils/logger';

dotenv.config();
validateEnv();

const PORT = 4000;

const startServer = async () => {
  await checkConnections();

  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  process.on('SIGTERM', () => {
    server.close(async () => {
      if (prisma) {
        try {
          await prisma.$disconnect();
        } catch (err) {
          logger.error({ err: err instanceof Error? err.message : err }, 'Error disconnecting Prisma');
        }
      }

      process.exit(0);
    });
  });
};

startServer();

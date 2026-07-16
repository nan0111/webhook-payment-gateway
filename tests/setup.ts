import prisma, { pool } from '../src/config/prisma';
import { redisConnection, emailQueue } from '../src/app';

afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }

  // コネクションプール終了
  if (pool) {
    await pool.end();
  }

  // Redis関連の終了
  await emailQueue.close();
  await redisConnection.quit();
});

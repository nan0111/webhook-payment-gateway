/**
 * Prisma Clientの初期化とデータベース接続設定。
 * PostgreSQLへのコネクションプールを管理し、アプリケーション全体で共有するインスタンスを提供する。
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
});

export default prisma;

import express, { Request, Response } from 'express';
import { verifyWebhook } from './middlewares/verifyWebhook';
import prisma from './config/prisma';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from './utils/logger';

const redisOptions = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
};
export const redisConnection = new IORedis(redisOptions);
export const emailQueue = new Queue('email', { connection: redisOptions });

export const checkConnections = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redisConnection.ping();
  } catch (error) {
    logger.error({ err: error instanceof Error? error.message : error }, 'Failed to connect to database or redis');
    process.exit(1);
  }
};

const app = express();

app.use(
  express.json({
    verify: (req: Request, res: Response, buf: Buffer) => {
      if (req.originalUrl.startsWith('/webhook')) {
        req.rawBody = buf;
      }
    },
  }),
);

app.get('/health', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redisConnection.ping();
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    logger.error({ err: error instanceof Error? error.message : error }, `Health check failed error`);
    return res.status(500).json({ status: 'error', message: 'Service unavailable' });
  }
});

app.post('/webhook/payment', verifyWebhook, async (req: Request, res: Response) => {
  const { event_id, order_id, status, email_addr } = req.body;

  if (!prisma || !redisConnection || !emailQueue) {
    logger.error('/webhook/payment Connection check failed: missing connection');
    return res.status(500).json({
      status: 'error',
      message: '/webhook/payment Connection check failed: missing connection',
    });
  }

  let returnCode = null;
  try {
    returnCode = await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.webhookEvent.findUnique({
        where: { eventId: event_id },
      });

      if (existingEvent) {
        throw new Error('ALREADY_PROCESSED');
      }

      const existingOrder = await tx.order.findUnique({
        where: { id: order_id },
      });

      if (!existingOrder) {
        throw new Error('ORDER_NO_DATA');
      }

      await tx.webhookEvent.create({
        data: { eventId: event_id },
      });

      await tx.order.update({
        where: { id: order_id },
        data: { status: status },
      });
    });

    logger.info({
      message: `/webhook/payment prisma.$transaction 完了`,
      event_id: req.body?.event_id,
      order_id: req.body?.order_id,
    });

    returnCode = await emailQueue.add(
      'send-payment-mail',
      { email: email_addr, orderId: order_id },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    );

    logger.info({
      message: `/webhook/payment emailQueue.add 完了`,
      event_id: req.body?.event_id,
      order_id: req.body?.order_id,
    });

    return res.sendStatus(200);
  } catch (error) {
    if (
      (error instanceof Error && error.message === 'ALREADY_PROCESSED') ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: unknown }).code === 'P2002')
    ) {
      logger.info({
        message: `/webhook/payment ALREADY_PROCESSED 完了`,
        event_id: req.body?.event_id,
        order_id: req.body?.order_id,
      });
      return res.sendStatus(200);
    }
    logger.error(
      {
        err: error instanceof Error? error.message : error,
        returnCode: returnCode,
        event_id: req.body?.event_id,
        order_id: req.body?.order_id,
      },
      'Webhook transaction failed',
    );
    return res.sendStatus(500);
  }
});

export default app;

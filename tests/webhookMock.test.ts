jest.mock('../src/config/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    webhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import request from 'supertest';
import crypto from 'crypto';
import { Express } from 'express';
import { Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../src/config/prisma';

// import app, { emailQueue } from '../src/app';
// jest.isolateModules() でモジュールの読み込みタイミングによるエラーを回避しています
let app: Express;
let emailQueue: Queue;
let redisConnection: IORedis;
jest.isolateModules(() => {
  const appModule = jest.requireActual('../src/app');

  app = appModule.default as Express;
  emailQueue = appModule.emailQueue as Queue;
  redisConnection = appModule.redisConnection as IORedis;
});

describe('Mock Test (prisma, emailQueue)', () => {
  const secret = 'test-secret';
  process.env.WEBHOOK_SECRET = secret;

  const tx = {
    webhookEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(emailQueue, 'add').mockResolvedValue({ id: 'job_id' } as Job);
  });

  afterAll(async () => {
    await emailQueue.close();
    await redisConnection.quit();
  });

  it('mock emailQueue.add正常 (ord_3) 期待ステータス:200', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      return await callback(tx);
    });
    (tx.webhookEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (tx.order.findUnique as jest.Mock).mockImplementation((args) => {
      if (args.where.id === 'ord_3') {
        return Promise.resolve({
          id: 'ord_3',
          emailAddr: 'test@example.com',
          status: 'PENDING',
        });
      }
      return Promise.resolve(null);
    });

    (tx.webhookEvent.create as jest.Mock).mockResolvedValue({
      id: 'evt_3',
      eventId: 'evt_3',
      processedAt: new Date(),
    });
    (tx.order.update as jest.Mock).mockResolvedValue({
      id: 'ord_3',
      emailAddr: 'test@example.com',
      status: 'PAID',
    });

    const payload = {
      event_id: 'evt_3',
      order_id: 'ord_3',
      status: 'PAID',
      email_addr: 'test@example.com',
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const res = await request(app)
      .post('/webhook/payment')
      .set('x-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('mock emailQueue.add異常 (ord_3) 期待ステータス:500', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      return await callback(tx);
    });
    (tx.webhookEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (tx.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'ord_3',
      emailAddr: 'test@example.com',
      status: 'PENDING',
    });
    (tx.webhookEvent.create as jest.Mock).mockResolvedValue({
      id: 'evt_3',
      eventId: 'evt_3',
      processedAt: new Date(),
    });
    (tx.order.update as jest.Mock).mockResolvedValue({
      id: 'ord_3',
      emailAddr: 'test@example.com',
      status: 'PAID',
    });
    jest.spyOn(emailQueue, 'add').mockRejectedValue(new Error('Queue Error'));

    const payload = {
      event_id: 'evt_3',
      order_id: 'ord_3',
      status: 'PAID',
      email_addr: 'test@example.com',
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const res = await request(app)
      .post('/webhook/payment')
      .set('x-signature', signature)
      .send(payload);

    expect(res.status).toBe(500);
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('mock signature正常 (ord_3)初回データ 期待ステータス:200 かつ キューにジョブが追加される', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      return await callback(tx);
    });
    (tx.webhookEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (tx.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'ord_3',
      emailAddr: 'test@example.com',
      status: 'PENDING',
    });
    (tx.webhookEvent.create as jest.Mock).mockResolvedValue({
      id: 'evt_3',
      eventId: 'evt_3',
      processedAt: new Date(),
    });
    (tx.order.update as jest.Mock).mockResolvedValue({
      id: 'ord_3',
      emailAddr: 'test@example.com',
      status: 'PAID',
    });

    const payload = {
      event_id: 'evt_3',
      order_id: 'ord_3',
      status: 'PAID',
      email_addr: 'test@example.com',
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const res = await request(app)
      .post('/webhook/payment')
      .set('x-signature', signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
  });

  it('mock prismaトランザクション内でエラーが発生した場合 期待ステータス:500', async () => {
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('MOCK DB_ERROR'));
    
    const payload = {
      event_id: 'evt_err',
      order_id: 'ord_1',
      status: 'PAID',
      email_addr: 'test@example.com',
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const res = await request(app)
      .post('/webhook/payment')
      .set('x-signature', signature)
      .send(payload);

    expect(res.status).toBe(500);
  });

  it('mock emailQueue.addでエラーが発生した場合 期待ステータス:500', async () => {
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      return await callback(tx);
    });
    (tx.webhookEvent.findUnique as jest.Mock).mockResolvedValue(null);
    (tx.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'ord_3',
      emailAddr: 'test@example.com',
      status: 'PENDING',
    });
    (tx.webhookEvent.create as jest.Mock).mockResolvedValue({
      id: 'evt_3',
      eventId: 'evt_3',
      processedAt: new Date(),
    });
    (tx.order.update as jest.Mock).mockResolvedValue({
      id: 'ord_3',
      emailAddr: 'test@example.com',
      status: 'PAID',
    });
    (emailQueue.add as jest.Mock).mockRejectedValue(new Error('QUEUE_ERROR'));

    const payload = {
      event_id: 'evt_queue_err',
      order_id: 'ord_1',
      status: 'PAID',
      email_addr: 'test@example.com',
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const res = await request(app)
      .post('/webhook/payment')
      .set('x-signature', signature)
      .send(payload);

    expect(res.status).toBe(500);
  });
});

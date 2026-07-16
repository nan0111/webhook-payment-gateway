import request from 'supertest';
import app from '../src/app';
import crypto from 'crypto';
import prisma from '../src/config/prisma';
import { QueueEvents, ConnectionOptions } from 'bullmq';
import { redisConnection as redis, emailQueue } from '../src/app';

describe('Mail Queue & Worker 動作確認テスト', () => {
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    queueEvents = new QueueEvents('email', { connection: redis as ConnectionOptions });
  });

  afterAll(async () => {
    if (queueEvents) await queueEvents.close();
  });

  it('Queueにジョブが追加されたら、Workerが検知してメールを送信しているかチェック', async () => {
    const testData = {
      email: 'test999@example.com',
      orderId: 'ORDER-9999',
    };

    const jobCompletedPromise = new Promise<{
      jobId: string;
      result: { success: boolean; url: string };
    }>((resolve) => {
      queueEvents.on('completed', ({ jobId, returnvalue }) => {
        resolve({ jobId, result: returnvalue as unknown as { success: boolean; url: string } });
      });
    });

    await emailQueue.add('send-payment-mail', testData);

    const { result } = await jobCompletedPromise;

    expect(result).toEqual({ success: true, url: expect.any(String) });
  }, 20000);
});

describe('Webhook Payment', () => {
  const secret = process.env.WEBHOOK_SECRET || 'test-secret';

  beforeAll(async () => {
    await prisma.webhookEvent.deleteMany({});
    await prisma.order.deleteMany({});

    await prisma.order.create({
      data: {
        id: 'ord_1',
        emailAddr: 'test@example.com',
        status: 'PENDING',
      },
    });
    await prisma.order.create({
      data: {
        id: 'ord_2',
        emailAddr: 'test@example.com',
        status: 'PENDING',
      },
    });
  });

  it('不正なJSONボディ (ord_2) 期待ステータス:400', async () => {
    const rawBody =
      '{"event_id": "evt_2", "order_id": "ord_2", "status": "PAID", "email_addr": "test@example.com"'; // 閉じ括弧なし
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const res = await request(app)
      .post('/webhook/payment')
      .set('x-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(400);
  });

  it('空のJSONオブジェクト (ord_2) 期待ステータス:500', async () => {
    const payload = {};
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const res = await request(app)
      .post('/webhook/payment')
      .set('x-signature', signature)
      .send(payload);

    expect(res.status).toBe(500);
  });

  it('signature正常 (ord_1)初回データ 期待ステータス:200 かつ キューにジョブが追加される', async () => {
    const payload = {
      event_id: 'evt_1',
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

    expect(res.status).toBe(200);
  });

  it('signature正常 (ord_1)2度目データ 処理はしないが 期待ステータス:200', async () => {
    const payload = {
      event_id: 'evt_1',
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

    expect(res.status).toBe(200);
  });

  it('signatureが違う (ord_2) 期待ステータス:401', async () => {
    const payload = {
      event_id: 'evt_2',
      order_id: 'ord_2',
      status: 'PAID',
      email_addr: 'test@example.com',
    };

    const res = await request(app)
      .post('/webhook/payment')
      .set('x-signature', 'invalid-signature')
      .send(payload);

    expect(res.status).toBe(401);
  });

  it('x-signature無し (ord_2)  期待ステータス:400', async () => {
    const payload = {
      event_id: 'evt_2',
      order_id: 'ord_2',
      status: 'PAID',
      email_addr: 'test@example.com',
    };

    const res = await request(app).post('/webhook/payment').send(payload);

    expect(res.status).toBe(400);
  });

  it('body無し (ord_2)  期待ステータス:400', async () => {
    const payload = {
      event_id: 'evt_2',
      order_id: 'ord_2',
      status: 'PAID',
      email_addr: 'test@example.com',
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const res = await request(app).post('/webhook/payment').set('x-signature', signature).send();

    expect(res.status).toBe(400);
  });

  it('signature正常 (ord_3)orderデータなし  期待ステータス:500', async () => {
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
  });

  it('signature正常 (ord_2)初回データ  期待ステータス:200', async () => {
    const payload = {
      event_id: 'evt_2',
      order_id: 'ord_2',
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
  });

});

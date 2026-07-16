import { Worker, ConnectionOptions } from 'bullmq';
import nodemailer, { Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { logger } from '../utils/logger';

const redisOptions: ConnectionOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

export const createTransporter = (config: SMTPTransport.Options) =>
  nodemailer.createTransport(config);

export const defaultTransporter = createTransporter({
  host: process.env.SMTP_HOST,
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const initMailWorker = (connection: ConnectionOptions, transporter: Transporter) => {
  logger.info('🚀 Mail Worker is starting...');

  const emailWorker = new Worker(
    'email',
    async (job) => {
      logger.info({ jobId: job.id }, `[Job ${job.id}] 処理開始: ${job.name}`);

      const { email, orderId } = job.data;

      try {
        const mailOptions = {
          from: '"Payment System" <noreply@example.com>',
          to: email,
          subject: `【重要】ご注文（ID: ${orderId}）の決済が完了しました`,
          text: `ご注文 ID: ${orderId} のお支払いが無事に完了しました。`,
        };

        const info = await transporter.sendMail(mailOptions);

        logger.info({ jobId: job.id, messageId: info.messageId }, `[Job ${job.id}] メール送信成功`);

        return { success: true, url: nodemailer.getTestMessageUrl(info) };
      } catch (error) {
        logger.error(
          { err: error instanceof Error ? error.message : error, jobId: job.id },
          `[Job ${job.id}] メール送信フェーズで失敗`,
        );
        throw error;
      }
    },
    {
      connection,
      concurrency: 5,
    },
  );

  emailWorker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, url: result.url }, `✅ [Job ${job.id}] 正常終了。`);
  });

  emailWorker.on('failed', (job, err) => {
    logger.error(
      { err: err.message, jobId: job?.id ?? 'unknown' },
      `❌ [Job ${job?.id ?? 'unknown'}] 異常終了`,
    );
  });

  return emailWorker;
};

// 本番用インスタンス
export const emailWorker = initMailWorker(redisOptions, defaultTransporter);

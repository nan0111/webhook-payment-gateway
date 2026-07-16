import crypto from 'crypto';
import { logger } from './logger';

export function verifySignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !rawBody || !signature) {
    return false;
  }

  try {
    const serverHashHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const serverHashBuffer = Buffer.from(serverHashHex, 'utf-8');
    const clientSignatureBuffer = Buffer.from(signature, 'utf-8');

    if (serverHashBuffer.length !== clientSignatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(serverHashBuffer, clientSignatureBuffer);
  } catch (error) {
    logger.error({ err: error instanceof Error? error.message : error }, 'Signature verification error');
    return false;
  }
}

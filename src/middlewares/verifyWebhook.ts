import { Request, Response, NextFunction } from 'express';
import { verifySignature } from '../utils/verifySignature';
import { logger } from '../utils/logger';

export function verifyWebhook(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers['x-signature'] as string;

  if (!signature) {
    logger.warn({ message: 'Missing signature header' });
    return res.status(400).json({ error: 'header error' });
  }

  const rawBody = req.rawBody;

  if (!rawBody) {
    logger.warn({ message: 'Missing raw body' });
    return res.status(400).json({ error: 'body error' });
  }

  const signatureValid = verifySignature(rawBody, signature);

  if (!signatureValid) {
    logger.warn({
      event_id: req.body?.event_id,
      order_id: req.body?.order_id,
      signature_valid: false,
      message: 'Invalid signature',
    });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

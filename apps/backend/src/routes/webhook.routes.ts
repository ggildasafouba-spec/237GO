import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyPayment } from '../services/payment.service';

const router = Router();
const prisma = new PrismaClient();

// Webhook CinetPay — Notification de paiement
router.post('/cinetpay', async (req: Request, res: Response) => {
  try {
    const { cpm_trans_id, cpm_site_id } = req.body;

    console.log(`🔔 Webhook CinetPay: Transaction ${cpm_trans_id}`);

    // Vérifier le paiement
    const result = await verifyPayment(cpm_trans_id);

    if (result.status === 'COMPLETED') {
      // Mettre à jour la transaction
      const transaction = await prisma.transaction.findFirst({
        where: { reference: cpm_trans_id },
        include: { wallet: true },
      });

      if (transaction && transaction.status !== 'COMPLETED') {
        await prisma.$transaction([
          prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'COMPLETED' },
          }),
          prisma.wallet.update({
            where: { id: transaction.walletId },
            data: { balance: { increment: transaction.amount } },
          }),
        ]);

        console.log(`✅ Paiement confirmé: ${transaction.amount} XAF pour wallet ${transaction.walletId}`);
      }
    } else if (result.status === 'FAILED') {
      await prisma.transaction.updateMany({
        where: { reference: cpm_trans_id },
        data: { status: 'FAILED' },
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook CinetPay Error:', error);
    res.status(200).json({ success: true }); // Toujours répondre 200
  }
});

// Webhook MTN MoMo
router.post('/momo', async (req: Request, res: Response) => {
  try {
    const { externalId, status, amount } = req.body;

    console.log(`🔔 Webhook MoMo: ${externalId} - ${status}`);

    if (status === 'SUCCESSFUL') {
      const transaction = await prisma.transaction.findFirst({
        where: { reference: externalId },
      });

      if (transaction && transaction.status !== 'COMPLETED') {
        await prisma.$transaction([
          prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'COMPLETED' },
          }),
          prisma.wallet.update({
            where: { id: transaction.walletId },
            data: { balance: { increment: transaction.amount } },
          }),
        ]);
      }
    } else if (status === 'FAILED') {
      await prisma.transaction.updateMany({
        where: { reference: externalId },
        data: { status: 'FAILED' },
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook MoMo Error:', error);
    res.status(200).json({ success: true });
  }
});

// Webhook Orange Money
router.post('/orange-money', async (req: Request, res: Response) => {
  try {
    const { order_id, status, notif_token } = req.body;

    console.log(`🔔 Webhook Orange Money: ${order_id} - ${status}`);

    if (status === 'SUCCESS') {
      const transaction = await prisma.transaction.findFirst({
        where: { reference: order_id },
      });

      if (transaction && transaction.status !== 'COMPLETED') {
        await prisma.$transaction([
          prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'COMPLETED' },
          }),
          prisma.wallet.update({
            where: { id: transaction.walletId },
            data: { balance: { increment: transaction.amount } },
          }),
        ]);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook Orange Money Error:', error);
    res.status(200).json({ success: true });
  }
});

export { router as webhookRouter };

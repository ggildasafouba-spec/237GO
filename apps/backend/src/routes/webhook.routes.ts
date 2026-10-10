import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { verifyPayment, verifyNotchPay, confirmDeposit, failDeposit } from '../services/payment.service';

const router = Router();

// Webhook NotchPay — notification de paiement (MoMo / Orange / carte)
router.post('/notchpay', async (req: Request, res: Response) => {
  try {
    // Vérification de la signature HMAC (clé de hachage NotchPay)
    const hashKey = process.env.NOTCHPAY_HASH_KEY || '';
    const signature = req.headers['x-notch-signature'] as string | undefined;
    if (hashKey && signature) {
      const computed = crypto
        .createHmac('sha256', hashKey)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (computed !== signature) {
        console.warn('🔔 Webhook NotchPay: signature invalide, ignoré');
        return res.status(200).json({ success: true });
      }
    }

    // La référence que nous avons envoyée = l'id de notre transaction
    const data = req.body?.data || req.body;
    const reference = data?.reference || data?.merchant_reference;
    const event = (req.body?.event || data?.status || '').toString().toLowerCase();
    console.log(`🔔 Webhook NotchPay: ${reference} - ${event}`);

    if (!reference) {
      return res.status(200).json({ success: true });
    }

    // Confirmer auprès de NotchPay avant de créditer (ne pas se fier au seul payload)
    const check = await verifyNotchPay(reference);
    if (check.status === 'COMPLETED') {
      await confirmDeposit(reference);
    } else if (check.status === 'FAILED') {
      await failDeposit(reference);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook NotchPay Error:', error);
    res.status(200).json({ success: true });
  }
});

// Webhook CinetPay — Notification de paiement
router.post('/cinetpay', async (req: Request, res: Response) => {
  try {
    const { cpm_trans_id } = req.body;
    console.log(`🔔 Webhook CinetPay: Transaction ${cpm_trans_id}`);

    if (!cpm_trans_id) {
      return res.status(200).json({ success: true });
    }

    // Vérifier le paiement auprès de CinetPay
    const result = await verifyPayment(cpm_trans_id);

    if (result.status === 'COMPLETED') {
      await confirmDeposit(cpm_trans_id);
    } else if (result.status === 'FAILED') {
      await failDeposit(cpm_trans_id);
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
    const { externalId, status } = req.body;
    console.log(`🔔 Webhook MoMo: ${externalId} - ${status}`);

    if (status === 'SUCCESSFUL') {
      await confirmDeposit(externalId);
    } else if (status === 'FAILED') {
      await failDeposit(externalId);
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
    const { order_id, status } = req.body;
    console.log(`🔔 Webhook Orange Money: ${order_id} - ${status}`);

    if (status === 'SUCCESS') {
      await confirmDeposit(order_id);
    } else if (status === 'FAILED' || status === 'CANCELLED') {
      await failDeposit(order_id);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook Orange Money Error:', error);
    res.status(200).json({ success: true });
  }
});

// URL de retour après paiement (redirection navigateur)
router.get('/return', (_req: Request, res: Response) => {
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>Paiement traité</h2><p>Vous pouvez retourner dans l\'application 237GO.</p></body></html>');
});

export { router as webhookRouter };

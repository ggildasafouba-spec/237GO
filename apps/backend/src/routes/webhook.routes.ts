import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { verifyPayment, verifyNotchPay, confirmDeposit, failDeposit } from '../services/payment.service';

const router = Router();

// Webhook NotchPay — notification de paiement (MoMo / Orange / carte)
router.post('/notchpay', async (req: Request, res: Response) => {
  try {
    // Vérification de signature (informative uniquement) : NotchPay signe le
    // corps BRUT avec la hash key. On la vérifie si on dispose du raw body,
    // mais on NE bloque PAS en cas d'écart, car la sécurité réelle vient du fait
    // qu'on reconfirme ensuite le paiement directement auprès de l'API NotchPay.
    const hashKey = process.env.NOTCHPAY_HASH_KEY || '';
    const signature = req.headers['x-notch-signature'] as string | undefined;
    const rawBody = (req as any).rawBody as string | undefined;
    if (hashKey && signature && rawBody) {
      try {
        const computed = crypto.createHmac('sha256', hashKey).update(rawBody).digest('hex');
        if (computed !== signature) {
          console.warn('🔔 Webhook NotchPay: signature non concordante (traitement poursuivi après revérification API)');
        }
      } catch {
        /* ignore */
      }
    }

    // NotchPay envoie { event, data: <paiement> }.
    // Le paiement contient SA référence (trx.xxx) et NOTRE merchant_reference.
    const data = req.body?.data || req.body?.transaction || req.body || {};
    const event = (req.body?.event || req.body?.type || data?.status || '').toString().toLowerCase();

    // On récupère toutes les références possibles pour retrouver notre transaction.
    const merchantRef = data?.merchant_reference || data?.metadata?.reference;
    const notchRef = data?.reference || data?.trxref || req.body?.reference;

    console.log(`🔔 Webhook NotchPay: event=${event} merchantRef=${merchantRef} notchRef=${notchRef}`);

    if (!merchantRef && !notchRef) {
      return res.status(200).json({ success: true });
    }

    // On reconfirme auprès de NotchPay avec la référence NotchPay (trx.xxx),
    // qui est celle que l'API /payments/{reference} comprend le mieux.
    const refForVerify = notchRef || merchantRef;
    const check = await verifyNotchPay(refForVerify);

    // Pour créditer, on utilise NOTRE référence (merchant) si on l'a, sinon la ref NotchPay.
    // confirmDeposit/failDeposit cherchent la transaction par ces références.
    const refForCredit = merchantRef || notchRef;

    if (check.status === 'COMPLETED') {
      const ok = await confirmDeposit(refForCredit);
      if (!ok && merchantRef && notchRef && refForCredit !== notchRef) {
        // repli : essayer avec l'autre référence
        await confirmDeposit(notchRef);
      }
    } else if (check.status === 'FAILED') {
      await failDeposit(refForCredit);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook NotchPay Error:', error);
    res.status(200).json({ success: true });
  }
});

// Webhook CinetPay — notification de paiement (MoMo / Orange / carte).
// CinetPay poste en x-www-form-urlencoded avec notre transaction_id dans cpm_trans_id.
// La signature HMAC (header x-token) est vérifiée si CINETPAY_SECRET_KEY est défini,
// mais la sécurité réelle vient de la re-vérification via l'API /payment/check.
router.post('/cinetpay', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    // Notre transaction_id arrive dans cpm_trans_id (ou metadata en repli).
    const transId = body.cpm_trans_id || body.transaction_id || body.metadata;

    console.log(`🔔 Webhook CinetPay: cpm_trans_id=${transId}`);

    if (!transId) {
      return res.status(200).json({ success: true });
    }

    // Vérification de signature HMAC (informative) : CinetPay signe le corps
    // (champs concaténés) avec la secret key et l'envoie dans le header x-token.
    const secretKey = process.env.CINETPAY_SECRET_KEY || '';
    const token = (req.headers['x-token'] as string | undefined) || body.token;
    if (secretKey && token) {
      try {
        // Concaténation des champs cpm_* dans l'ordre reçu (modèle CinetPay HMAC-SHA256).
        const dataString = [
          body.cpm_site_id, body.cpm_trans_id, body.cpm_trans_date, body.cpm_amount,
          body.cpm_currency, body.signature, body.payment_method, body.cel_phone_num,
          body.cpm_phone_prefixe, body.cpm_language, body.cpm_version, body.cpm_payment_config,
          body.cpm_page_action, body.cpm_custom, body.cpm_designation, body.cpm_error_message,
        ].join('');
        const computed = crypto.createHmac('sha256', secretKey).update(dataString).digest('hex');
        if (computed !== token) {
          console.warn('🔔 Webhook CinetPay: signature non concordante (traitement poursuivi après revérification API)');
        }
      } catch {
        /* ignore — la revérification API reste la source de vérité */
      }
    }

    // Source de vérité : re-vérifier le paiement auprès de CinetPay.
    const result = await verifyPayment(transId);

    if (result.status === 'COMPLETED') {
      await confirmDeposit(transId);
    } else if (result.status === 'FAILED') {
      await failDeposit(transId);
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

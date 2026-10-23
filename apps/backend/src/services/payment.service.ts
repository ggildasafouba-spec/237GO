import axios from 'axios';

// ========== NOTCHPAY (Passerelle Mobile Money Cameroun : MoMo + Orange) ==========

const notchPayConfig = {
  publicKey: process.env.NOTCHPAY_PUBLIC_KEY || '',
  baseUrl: 'https://api.notchpay.co',
};

export function isNotchPayConfigured(): boolean {
  return !!notchPayConfig.publicKey;
}

/**
 * Initialise un paiement NotchPay (hébergé). Renvoie une URL de paiement
 * vers laquelle rediriger l'utilisateur (il y choisit MoMo / Orange / carte).
 * NotchPay notifie ensuite notre webhook /webhooks/notchpay.
 */
export async function initiateNotchPay(data: {
  amount: number;
  phone: string;
  transactionId: string;
  description: string;
  customerName: string;
  callbackUrl: string;
}): Promise<PaymentResponse> {
  try {
    const response = await axios.post(
      `${notchPayConfig.baseUrl}/payments`,
      {
        amount: data.amount,
        currency: 'XAF',
        reference: data.transactionId,
        description: data.description,
        callback: data.callbackUrl,
        customer: {
          name: data.customerName,
          phone: data.phone,
        },
      },
      {
        headers: {
          Authorization: notchPayConfig.publicKey,
          'Content-Type': 'application/json',
        },
        // Évite qu'une lenteur de NotchPay fasse pendre indéfiniment la requête.
        timeout: 20000,
      }
    );

    // NotchPay renvoie une authorization_url pour finaliser le paiement
    const authUrl = response.data?.authorization_url || response.data?.transaction?.authorization_url;
    const ref = response.data?.transaction?.reference || data.transactionId;

    if (authUrl) {
      return {
        success: true,
        paymentUrl: authUrl,
        transactionRef: ref,
        message: 'Paiement initié. Finalisez sur la page sécurisée.',
      };
    }

    return { success: false, message: response.data?.message || 'Erreur NotchPay' };
  } catch (error: any) {
    console.error('NotchPay Error:', error.response?.data || error.message);
    return { success: false, message: 'Service de paiement indisponible' };
  }
}

/**
 * Vérifie l'état d'un paiement NotchPay par sa référence.
 */
export async function verifyNotchPay(reference: string): Promise<{
  success: boolean;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  amount?: number;
  message: string;
}> {
  try {
    const response = await axios.get(`${notchPayConfig.baseUrl}/payments/${reference}`, {
      headers: { Authorization: notchPayConfig.publicKey },
      timeout: 20000,
    });

    // Selon l'endpoint, NotchPay renvoie le statut sous transaction.status ou status.
    const tx = response.data?.transaction || response.data?.data || response.data || {};
    const status = (tx.status || response.data?.status || '').toString().toLowerCase();

    if (status === 'complete' || status === 'completed' || status === 'successful' || status === 'success') {
      return {
        success: true,
        status: 'COMPLETED',
        amount: tx.amount,
        message: 'Paiement confirmé',
      };
    }
    if (status === 'pending' || status === 'processing' || status === 'initialized' || status === '') {
      // Statut vide = encore en cours de traitement : NE PAS marquer échoué.
      return { success: true, status: 'PENDING', message: 'Paiement en attente' };
    }
    // canceled, failed, rejected, expired...
    return { success: false, status: 'FAILED', message: `Paiement ${status}` };
  } catch (error: any) {
    // Erreur réseau/temporaire : on reste en PENDING pour ne pas annuler à tort un paiement en cours.
    console.error('verifyNotchPay error:', error.response?.data || error.message);
    return { success: true, status: 'PENDING', message: 'Vérification temporairement indisponible' };
  }
}

// ========== CINETPAY (API Aurore v1 : OAuth + MoMo/Orange) ==========

const cinetPayConfig = {
  apiKey: process.env.CINETPAY_API_KEY || '',
  apiPassword: process.env.CINETPAY_API_PASSWORD || process.env.CINETPAY_SECRET_KEY || '',
  // API "Aurore" (v1). Sandbox: https://api.cinetpay.net ; Production: https://api.cinetpay.net
  // (CinetPay distingue sandbox/prod via les clés, pas via l'URL). Surchargeable par env.
  baseUrl: process.env.CINETPAY_BASE_URL || 'https://api.cinetpay.net',
};

export interface PaymentRequest {
  amount: number;
  currency: string;
  transactionId: string;
  description: string;
  customerPhone: string;
  customerName: string;
  paymentMethod: 'ORANGE_MONEY' | 'MTN_MOMO' | 'EXPRESS_UNION';
  notifyUrl: string;
  returnUrl?: string;
  customerEmail?: string;
}

export interface PaymentResponse {
  success: boolean;
  paymentUrl?: string;
  transactionRef?: string;
  message: string;
}

export function isCinetPayConfigured(): boolean {
  return !!(cinetPayConfig.apiKey && cinetPayConfig.apiPassword);
}

// ----- Gestion du jeton OAuth (mise en cache) -----
let cinetPayToken: { value: string; expiresAt: number } | null = null;

/**
 * Récupère un jeton d'accès CinetPay (API Aurore) via /v1/oauth/login.
 * Le jeton est mis en cache jusqu'à ~5 min avant son expiration.
 */
async function getCinetPayToken(): Promise<string | null> {
  // Réutiliser le jeton en cache s'il est encore valide
  if (cinetPayToken && Date.now() < cinetPayToken.expiresAt) {
    return cinetPayToken.value;
  }
  try {
    const response = await axios.post(
      `${cinetPayConfig.baseUrl}/v1/oauth/login`,
      {
        api_key: cinetPayConfig.apiKey,
        api_password: cinetPayConfig.apiPassword,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
    );

    // Le jeton peut être renvoyé sous data.token, token, ou access_token selon la version.
    const data = response.data?.data || response.data || {};
    const token = data.token || data.access_token || response.data?.token;
    // Durée de vie : expires_in (secondes) si fourni, sinon on prend 23h par défaut.
    const expiresInSec = Number(data.expires_in || response.data?.expires_in || 82800);

    if (token) {
      cinetPayToken = {
        value: token,
        expiresAt: Date.now() + (expiresInSec - 300) * 1000, // marge de 5 min
      };
      return token;
    }
    console.error('CinetPay login: jeton introuvable', response.data);
    return null;
  } catch (error: any) {
    console.error('CinetPay login error:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Initialise un paiement CinetPay (API Aurore, POST /v1/payment).
 * Flux : login OAuth -> création du paiement -> on récupère payment_url.
 * L'utilisateur est redirigé vers payment_url pour choisir MoMo / Orange.
 */
export async function initiatePayment(data: PaymentRequest): Promise<PaymentResponse> {
  try {
    const token = await getCinetPayToken();
    if (!token) {
      return { success: false, message: 'Authentification CinetPay impossible' };
    }

    // Montant multiple de 5 (exigence Mobile Money zone CEMAC/UEMOA).
    const amount = Math.round(data.amount / 5) * 5;

    // Email requis par l'API : on en fabrique un si absent.
    const safePhone = (data.customerPhone || '').replace(/[^0-9]/g, '');
    const customerEmail = data.customerEmail || `${safePhone || 'client'}@237go.app`;

    // Prénom / nom : l'API exige au moins 2 caractères chacun.
    const parts = (data.customerName || 'Client 237GO').trim().split(/\s+/);
    const firstName = (parts[0] || 'Client').padEnd(2, ' ').trim() || 'Client';
    const lastName = (parts.slice(1).join(' ') || '237GO').padEnd(2, ' ').trim() || '237GO';

    const returnUrl = data.returnUrl || '';

    const response = await axios.post(
      `${cinetPayConfig.baseUrl}/v1/payment`,
      {
        currency: data.currency || 'XAF',
        merchant_transaction_id: data.transactionId,
        amount,
        lang: 'fr',
        designation: data.description,
        client_email: customerEmail,
        client_phone_number: data.customerPhone || '',
        client_first_name: firstName,
        client_last_name: lastName,
        success_url: returnUrl,
        failed_url: returnUrl,
        notify_url: data.notifyUrl,
        direct_pay: false,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    // Réponse SUCCESS Aurore : code 200/OK + payment_url + payment_token + transaction_id
    const body = response.data || {};
    const status = (body.status || '').toString().toUpperCase();
    const paymentUrl = body.payment_url;

    if ((body.code === 200 || status === 'OK') && paymentUrl) {
      return {
        success: true,
        paymentUrl,
        // On conserve le transaction_id CinetPay pour retrouver/vérifier la transaction.
        transactionRef: body.transaction_id || body.payment_token || data.transactionId,
        message: 'Paiement initié. Finalisez sur la page sécurisée.',
      };
    }

    return {
      success: false,
      message: body.message || body.details?.message || 'Erreur CinetPay',
    };
  } catch (error: any) {
    console.error('CinetPay Error:', error.response?.data || error.message);
    return { success: false, message: 'Service de paiement indisponible' };
  }
}

/**
 * Vérifie l'état d'un paiement CinetPay (API Aurore) par NOTRE merchant_transaction_id.
 * C'est la source de vérité : on l'appelle après chaque notification webhook.
 */
export async function verifyPayment(transactionId: string): Promise<{
  success: boolean;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  amount?: number;
  message: string;
}> {
  try {
    const token = await getCinetPayToken();
    if (!token) {
      // Impossible de vérifier pour l'instant : rester en PENDING.
      return { success: true, status: 'PENDING', message: 'Authentification CinetPay indisponible' };
    }

    // Statut du paiement : GET /v1/payment/{merchant_transaction_id}/status
    const response = await axios.get(
      `${cinetPayConfig.baseUrl}/v1/payment/${encodeURIComponent(transactionId)}/status`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      }
    );

    // La réponse contient un statut (status) et un objet details.
    const body = response.data || {};
    const detail = body.details || body.data || body;
    const status = (detail.status || body.status || '').toString().toUpperCase();
    const amount = detail.amount ? Number(detail.amount) : undefined;

    if (status === 'SUCCESS' || status === 'ACCEPTED' || status === 'COMPLETED' || status === 'SUCCES') {
      return { success: true, status: 'COMPLETED', amount, message: 'Paiement confirmé' };
    }
    if (status === 'INITIATED' || status === 'PENDING' || status === 'WAITING' || status === '') {
      // En cours : NE PAS marquer échoué.
      return { success: true, status: 'PENDING', message: 'Paiement en attente' };
    }
    // FAILED, REFUSED, CANCELED...
    return { success: false, status: 'FAILED', message: `Paiement ${status || 'refusé'}` };
  } catch (error: any) {
    // 404 = transaction inconnue/non finalisée : rester en PENDING (ne pas annuler à tort).
    console.error('verifyPayment (CinetPay) error:', error.response?.data || error.message);
    return { success: true, status: 'PENDING', message: 'Vérification temporairement indisponible' };
  }
}

// ========== MTN MOBILE MONEY API ==========

interface MoMoConfig {
  apiKey: string;
  subscriptionKey: string;
  baseUrl: string;
  environment: string;
}

const momoConfig: MoMoConfig = {
  apiKey: process.env.MOMO_API_KEY || '',
  subscriptionKey: process.env.MOMO_SUBSCRIPTION_KEY || '',
  baseUrl: process.env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com',
  environment: process.env.MOMO_ENVIRONMENT || 'sandbox',
};

export async function initiateMoMoPayment(data: {
  amount: number;
  phone: string;
  transactionId: string;
  description: string;
}): Promise<PaymentResponse> {
  try {
    // Obtenir le token d'accès
    const tokenResponse = await axios.post(
      `${momoConfig.baseUrl}/collection/token/`,
      {},
      {
        headers: {
          'Ocp-Apim-Subscription-Key': momoConfig.subscriptionKey,
          Authorization: `Basic ${Buffer.from(`${momoConfig.apiKey}:${momoConfig.apiKey}`).toString('base64')}`,
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;

    // Initier le paiement
    await axios.post(
      `${momoConfig.baseUrl}/collection/v1_0/requesttopay`,
      {
        amount: data.amount.toString(),
        currency: 'XAF',
        externalId: data.transactionId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: `237${data.phone}`,
        },
        payerMessage: data.description,
        payeeNote: '237GO Payment',
      },
      {
        headers: {
          'X-Reference-Id': data.transactionId,
          'X-Target-Environment': momoConfig.environment,
          'Ocp-Apim-Subscription-Key': momoConfig.subscriptionKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      success: true,
      transactionRef: data.transactionId,
      message: 'Demande de paiement envoyée. Confirmez sur votre téléphone.',
    };
  } catch (error: any) {
    console.error('MoMo Error:', error.response?.data || error.message);
    return { success: false, message: 'Erreur MTN MoMo' };
  }
}

// ========== ORANGE MONEY API ==========

export async function initiateOrangeMoneyPayment(data: {
  amount: number;
  phone: string;
  transactionId: string;
  description: string;
}): Promise<PaymentResponse> {
  try {
    const tokenResponse = await axios.post(
      'https://api.orange.com/oauth/v3/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.ORANGE_MONEY_CLIENT_ID}:${process.env.ORANGE_MONEY_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;

    const paymentResponse = await axios.post(
      'https://api.orange.com/orange-money-webpay/cm/v1/webpayment',
      {
        merchant_key: process.env.ORANGE_MONEY_MERCHANT_KEY,
        currency: 'OUV',
        order_id: data.transactionId,
        amount: data.amount,
        return_url: `${process.env.API_BASE_URL}/api/wallet/payment/callback`,
        cancel_url: `${process.env.API_BASE_URL}/api/wallet/payment/cancel`,
        notif_url: `${process.env.API_BASE_URL}/api/wallet/payment/notify`,
        lang: 'fr',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      success: true,
      paymentUrl: paymentResponse.data.payment_url,
      transactionRef: paymentResponse.data.pay_token,
      message: 'Redirection vers Orange Money',
    };
  } catch (error: any) {
    console.error('Orange Money Error:', error.response?.data || error.message);
    return { success: false, message: 'Erreur Orange Money' };
  }
}

// ========== HELPER ==========

// ========== PAIEMENT UNIFIÉ ==========

export async function processPayment(data: PaymentRequest): Promise<PaymentResponse> {
  const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3002}`;

  // Choix de la passerelle via PAYMENT_PROVIDER (cinetpay | notchpay).
  // Par défaut : notchpay (comportement historique), avec repli automatique si l'un n'est pas configuré.
  const provider = (process.env.PAYMENT_PROVIDER || 'notchpay').toLowerCase();

  const useCinetPay =
    (provider === 'cinetpay' && isCinetPayConfigured()) ||
    (!isNotchPayConfigured() && isCinetPayConfigured());

  if (useCinetPay) {
    return initiatePayment({
      ...data,
      currency: data.currency || 'XAF',
      notifyUrl: `${apiBaseUrl}/api/webhooks/cinetpay`,
      returnUrl: data.returnUrl || `${apiBaseUrl}/api/webhooks/return`,
    });
  }

  // Passerelle NotchPay (gère MoMo + Orange + carte au Cameroun)
  if (isNotchPayConfigured()) {
    return initiateNotchPay({
      amount: data.amount,
      phone: data.customerPhone,
      transactionId: data.transactionId,
      description: data.description,
      customerName: data.customerName,
      callbackUrl: `${apiBaseUrl}/api/webhooks/return`,
    });
  }

  switch (data.paymentMethod) {
    case 'MTN_MOMO':
      return initiateMoMoPayment({
        amount: data.amount,
        phone: data.customerPhone,
        transactionId: data.transactionId,
        description: data.description,
      });

    case 'ORANGE_MONEY':
      return initiateOrangeMoneyPayment({
        amount: data.amount,
        phone: data.customerPhone,
        transactionId: data.transactionId,
        description: data.description,
      });

    default:
      // Fallback CinetPay pour Express Union et autres
      return initiatePayment(data);
  }
}


// ========== CONFIRMATION DE DÉPÔT (appelée par les webhooks) ==========

import { prisma } from '../lib/prisma';
import { addLoyaltyPoints } from './loyalty.service';

/**
 * Confirme un dépôt après validation du paiement par le prestataire (webhook).
 * Crédite le wallet du montant + bonus, puis ajoute les points de fidélité.
 * Idempotent : ne fait rien si la transaction est déjà COMPLETED.
 *
 * @param reference  La référence de la transaction (= son id)
 */
export async function confirmDeposit(reference: string): Promise<boolean> {
  // On cherche la transaction par NOTRE référence OU par la référence NotchPay
  // (trx.xxx) mémorisée dans metadata.notchRef lors de la création.
  const transaction =
    (await prisma.transaction.findFirst({ where: { reference } })) ||
    (await prisma.transaction.findFirst({
      where: { metadata: { path: ['notchRef'], equals: reference } },
    }));

  if (!transaction) {
    console.warn(`confirmDeposit: transaction introuvable pour la référence ${reference}`);
    return false;
  }

  // Idempotence : déjà traité
  if (transaction.status === 'COMPLETED') {
    return true;
  }

  // Récupérer le bonus stocké dans metadata
  const metadata = (transaction.metadata as { bonus?: number; originalAmount?: number }) || {};
  const bonus = metadata.bonus || 0;
  const totalCredit = transaction.amount + bonus;

  // Créditer le wallet et marquer la transaction comme complétée
  await prisma.$transaction([
    prisma.wallet.update({
      where: { id: transaction.walletId },
      data: { balance: { increment: totalCredit } },
    }),
    prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'COMPLETED' },
    }),
  ]);

  // Ajouter les points de fidélité (1 point / 500 XAF rechargés) + recalcul du palier
  const loyaltyPointsEarned = Math.floor(transaction.amount / 500);
  if (loyaltyPointsEarned > 0) {
    const wallet = await prisma.wallet.findUnique({ where: { id: transaction.walletId } });
    if (wallet) {
      await addLoyaltyPoints(wallet.userId, loyaltyPointsEarned).catch(() => {});
    }
  }

  console.log(`✅ Dépôt confirmé: ${totalCredit} XAF crédités (ref ${reference})`);
  return true;
}

/**
 * Marque un dépôt comme échoué.
 */
export async function failDeposit(reference: string): Promise<void> {
  // Essayer par notre référence, sinon par la référence NotchPay (metadata.notchRef)
  const byRef = await prisma.transaction.updateMany({
    where: { reference, status: 'PENDING' },
    data: { status: 'FAILED' },
  });
  if (byRef.count === 0) {
    const tx = await prisma.transaction.findFirst({
      where: { metadata: { path: ['notchRef'], equals: reference }, status: 'PENDING' },
    });
    if (tx) {
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
    }
  }
}

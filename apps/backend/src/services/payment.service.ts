import axios from 'axios';

// ========== CINETPAY (Passerelle universelle) ==========

interface CinetPayConfig {
  apiKey: string;
  siteId: string;
  baseUrl: string;
}

const cinetPayConfig: CinetPayConfig = {
  apiKey: process.env.CINETPAY_API_KEY || '',
  siteId: process.env.CINETPAY_SITE_ID || '',
  baseUrl: 'https://api-checkout.cinetpay.com/v2',
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
}

export interface PaymentResponse {
  success: boolean;
  paymentUrl?: string;
  transactionRef?: string;
  message: string;
}

export async function initiatePayment(data: PaymentRequest): Promise<PaymentResponse> {
  try {
    const response = await axios.post(`${cinetPayConfig.baseUrl}/payment`, {
      apikey: cinetPayConfig.apiKey,
      site_id: cinetPayConfig.siteId,
      transaction_id: data.transactionId,
      amount: data.amount,
      currency: data.currency || 'XAF',
      description: data.description,
      customer_phone_number: data.customerPhone,
      customer_name: data.customerName,
      channels: getChannel(data.paymentMethod),
      notify_url: data.notifyUrl,
      return_url: data.returnUrl || '',
    });

    if (response.data.code === '201') {
      return {
        success: true,
        paymentUrl: response.data.data.payment_url,
        transactionRef: response.data.data.payment_token,
        message: 'Paiement initié',
      };
    }

    return { success: false, message: response.data.message || 'Erreur CinetPay' };
  } catch (error: any) {
    console.error('CinetPay Error:', error.message);
    return { success: false, message: 'Service de paiement indisponible' };
  }
}

export async function verifyPayment(transactionId: string): Promise<{
  success: boolean;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  amount?: number;
  message: string;
}> {
  try {
    const response = await axios.post(`${cinetPayConfig.baseUrl}/payment/check`, {
      apikey: cinetPayConfig.apiKey,
      site_id: cinetPayConfig.siteId,
      transaction_id: transactionId,
    });

    const status = response.data.data?.status;

    if (status === 'ACCEPTED') {
      return {
        success: true,
        status: 'COMPLETED',
        amount: response.data.data.amount,
        message: 'Paiement confirmé',
      };
    } else if (status === 'PENDING') {
      return { success: true, status: 'PENDING', message: 'Paiement en attente' };
    }

    return { success: false, status: 'FAILED', message: 'Paiement échoué' };
  } catch (error: any) {
    return { success: false, status: 'FAILED', message: error.message };
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

function getChannel(method: string): string {
  switch (method) {
    case 'ORANGE_MONEY': return 'ORANGE_MONEY';
    case 'MTN_MOMO': return 'MOBILE_MONEY';
    case 'EXPRESS_UNION': return 'EXPRESS_UNION';
    default: return 'ALL';
  }
}

// ========== PAIEMENT UNIFIÉ ==========

export async function processPayment(data: PaymentRequest): Promise<PaymentResponse> {
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

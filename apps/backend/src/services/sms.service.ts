import axios from 'axios';

interface SMSConfig {
  provider: 'twilio' | 'africas_talking' | 'infobip';
  apiKey: string;
  senderId: string;
  baseUrl: string;
}

const smsConfig: SMSConfig = {
  provider: (process.env.SMS_PROVIDER as any) || 'africas_talking',
  apiKey: process.env.SMS_API_KEY || '',
  senderId: process.env.SMS_SENDER_ID || '237GO',
  baseUrl: process.env.SMS_BASE_URL || 'https://api.africastalking.com/version1',
};

export interface SMSRequest {
  to: string; // Format: 6XXXXXXXX
  message: string;
}

export interface SMSResponse {
  success: boolean;
  messageId?: string;
  message: string;
}

/**
 * Envoyer un SMS
 */
export async function sendSMS(data: SMSRequest): Promise<SMSResponse> {
  const phone = formatPhone(data.to);

  try {
    switch (smsConfig.provider) {
      case 'africas_talking':
        return sendViaAfricasTalking(phone, data.message);
      case 'infobip':
        return sendViaInfobip(phone, data.message);
      default:
        return sendViaAfricasTalking(phone, data.message);
    }
  } catch (error: any) {
    console.error('SMS Error:', error.message);
    return { success: false, message: 'Échec d\'envoi SMS' };
  }
}

/**
 * Envoyer un OTP par SMS
 */
export async function sendOTP(phone: string): Promise<{ success: boolean; code: string }> {
  const code = generateOTP();
  const message = `Votre code 237GO: ${code}. Valable 5 minutes. Ne partagez pas ce code.`;

  const result = await sendSMS({ to: phone, message });
  return { success: result.success, code };
}

/**
 * Envoyer une alerte SOS par SMS
 */
export async function sendSOSAlert(data: {
  contacts: { name: string; phone: string }[];
  userName: string;
  lat: number;
  lng: number;
  rideId?: string;
}): Promise<void> {
  const mapLink = `https://maps.google.com/?q=${data.lat},${data.lng}`;
  const message = `🚨 URGENCE 237GO: ${data.userName} a déclenché une alerte SOS. Position: ${mapLink}${data.rideId ? ` (Course #${data.rideId.substring(0, 8)})` : ''}. Contactez-le immédiatement.`;

  const promises = data.contacts.map((contact) =>
    sendSMS({ to: contact.phone, message })
  );

  await Promise.allSettled(promises);
  console.log(`📱 SOS envoyé à ${data.contacts.length} contact(s)`);
}

/**
 * Envoyer un lien de suivi de course
 */
export async function sendTripShareLink(data: {
  contactPhone: string;
  passengerName: string;
  rideId: string;
  trackingUrl: string;
}): Promise<SMSResponse> {
  const message = `${data.passengerName} partage sa course 237GO avec vous. Suivez en temps réel: ${data.trackingUrl}`;
  return sendSMS({ to: data.contactPhone, message });
}

/**
 * Notification de course au chauffeur
 */
export async function notifyDriverSMS(data: {
  driverPhone: string;
  pickup: string;
  price: number;
}): Promise<SMSResponse> {
  const message = `237GO: Nouvelle course ! Départ: ${data.pickup}. Prix: ${data.price} XAF. Ouvrez l'app pour accepter.`;
  return sendSMS({ to: data.driverPhone, message });
}

/**
 * Confirmation de commande marchand
 */
export async function notifyMerchantOrder(data: {
  merchantPhone: string;
  orderId: string;
  total: number;
  itemCount: number;
}): Promise<SMSResponse> {
  const message = `237GO Market: Nouvelle commande #${data.orderId.substring(0, 8)} ! ${data.itemCount} article(s), total: ${data.total} XAF. Préparez la commande.`;
  return sendSMS({ to: data.merchantPhone, message });
}

// ========== PROVIDERS ==========

async function sendViaAfricasTalking(phone: string, message: string): Promise<SMSResponse> {
  const response = await axios.post(
    `${smsConfig.baseUrl}/messaging`,
    new URLSearchParams({
      username: process.env.AFRICAS_TALKING_USERNAME || 'sandbox',
      to: phone,
      message,
      from: smsConfig.senderId,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey: smsConfig.apiKey,
      },
    }
  );

  const recipients = response.data?.SMSMessageData?.Recipients || [];
  if (recipients.length > 0 && recipients[0].status === 'Success') {
    return { success: true, messageId: recipients[0].messageId, message: 'SMS envoyé' };
  }

  return { success: false, message: 'Échec envoi AfricasTalking' };
}

async function sendViaInfobip(phone: string, message: string): Promise<SMSResponse> {
  const response = await axios.post(
    `${process.env.INFOBIP_BASE_URL}/sms/2/text/advanced`,
    {
      messages: [{
        from: smsConfig.senderId,
        destinations: [{ to: phone }],
        text: message,
      }],
    },
    {
      headers: {
        Authorization: `App ${smsConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const msgInfo = response.data?.messages?.[0];
  if (msgInfo?.status?.groupName === 'PENDING') {
    return { success: true, messageId: msgInfo.messageId, message: 'SMS envoyé' };
  }

  return { success: false, message: 'Échec envoi Infobip' };
}

// ========== HELPERS ==========

function formatPhone(phone: string): string {
  // Convertir 6XXXXXXXX en +2376XXXXXXXX
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('237')) return `+${cleaned}`;
  if (cleaned.startsWith('6')) return `+237${cleaned}`;
  return `+237${cleaned}`;
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

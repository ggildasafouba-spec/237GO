import { Linking, Alert } from 'react-native';

/** Pages légales publiées sur le site 237GO (lisibles sans application). */
const SITE = 'https://www.237go.app';
export const LEGAL_URLS = {
  terms: `${SITE}/cgu.html`,
  privacy: `${SITE}/privacy.html`,
  legal: `${SITE}/mentions-legales.html`,
  deletion: `${SITE}/suppression-compte.html`,
};

/** Contacts du support 237GO. */
export const SUPPORT = {
  whatsapp: '+33650222474',
  whatsappLabel: '+33 6 50 22 24 74',
  email: 'contact@237go.app',
};

export async function openUrl(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Lien', url);
  }
}

export function openWhatsAppSupport(message = 'Bonjour 237GO, j\'ai besoin d\'aide : ') {
  return openUrl(`https://wa.me/${SUPPORT.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`);
}

export function openEmailSupport(subject = 'Aide 237GO') {
  return openUrl(`mailto:${SUPPORT.email}?subject=${encodeURIComponent(subject)}`);
}

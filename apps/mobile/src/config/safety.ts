import { Share, Platform, Alert } from 'react-native';
import api from './api';
import { getSocket } from './socket';

export interface SosResult {
  alertId?: string;
  contactsCount: number;
  smsSent: number;
  shareMessage: string;
}

/**
 * Déclenche une alerte SOS. Passe par l'API (réponse garantie) ; si le réseau HTTP échoue,
 * on tente encore le canal temps réel. L'équipe 237GO est prévenue côté serveur.
 */
export async function sendSos(lat: number, lng: number, rideId?: string): Promise<SosResult> {
  try {
    const res = await api.post('/safety/sos', { lat, lng, rideId }, { timeout: 15000 });
    return res.data.data as SosResult;
  } catch (error) {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('sos', { lat, lng, rideId });
      return {
        contactsCount: 0,
        smsSent: 0,
        shareMessage: `🚨 URGENCE : j'ai déclenché une alerte SOS sur 237GO. Ma position : https://maps.google.com/?q=${lat},${lng}. Appelez-moi immédiatement.`,
      };
    }
    throw error;
  }
}

/** Lien de suivi de la course en cours (valable 12 h). */
export async function getTripShare(rideId: string): Promise<{ url: string; message: string }> {
  const res = await api.post(`/safety/rides/${rideId}/share`);
  return res.data.data;
}

/**
 * Ouvre le menu de partage du téléphone (WhatsApp, SMS, Messenger…).
 * Sur le web, si le navigateur ne sait pas partager, le texte est affiché pour être copié.
 */
export async function shareText(message: string, title = '237GO'): Promise<void> {
  try {
    await Share.share(Platform.OS === 'ios' ? { message } : { message, title });
  } catch {
    // Navigateur sans partage natif : on copie le texte pour qu'il soit collé dans WhatsApp
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (Platform.OS === 'web' && nav?.clipboard?.writeText) {
      try {
        await nav.clipboard.writeText(message);
        Alert.alert('Message copié', 'Collez-le dans WhatsApp ou dans un SMS :\n\n' + message);
        return;
      } catch { /* on affiche simplement le texte */ }
    }
    Alert.alert(title, message);
  }
}

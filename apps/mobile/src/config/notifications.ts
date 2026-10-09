import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import api from './api';

// Détecte si on tourne dans Expo Go (où les push distants ne sont plus supportés depuis SDK 53)
const isExpoGo = Constants.appOwnership === 'expo';

// Afficher les notifications locales même au premier plan (sans effet dans Expo Go)
if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Demande la permission, récupère le token Expo Push et l'enregistre côté backend.
 * À appeler après la connexion de l'utilisateur.
 *
 * Dans Expo Go, cette fonction ne fait rien (les push distants nécessitent un
 * build de développement / APK). L'app fonctionne normalement sans push.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Dans Expo Go : on saute complètement l'init push pour éviter les erreurs
  if (isExpoGo) {
    console.log('Expo Go détecté : notifications push désactivées (utilisez un build APK pour les activer).');
    return null;
  }

  try {
    // Config du canal Android (obligatoire pour les notifs Android)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: '237GO',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1B5E20',
      });
    }

    // Demander la permission
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Permission notifications refusée');
      return null;
    }

    // Récupérer le token Expo
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    // Enregistrer le token côté backend
    if (token) {
      await api.post('/users/push-token', { pushToken: token }).catch(() => {});
    }

    return token;
  } catch (error) {
    console.log('Erreur enregistrement push:', error);
    return null;
  }
}

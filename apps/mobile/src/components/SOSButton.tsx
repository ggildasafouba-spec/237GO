import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Vibration,
  Linking,
} from 'react-native';
import { sendSos, shareText } from '../config/safety';
import { useLocation } from '../hooks/useLocation';
import { colors, spacing, typography } from '../theme';

interface SOSButtonProps {
  rideId?: string;
  style?: object;
}

export default function SOSButton({ rideId, style }: SOSButtonProps) {
  const [isSending, setIsSending] = useState(false);
  const { getCurrentLocation } = useLocation();

  const handleSOS = () => {
    Alert.alert(
      '🚨 URGENCE',
      'Envoyer une alerte SOS ?\n\nVotre position sera envoyée à l\'équipe 237GO.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: '🚨 ENVOYER SOS',
          style: 'destructive',
          onPress: sendSOS,
        },
      ]
    );
  };

  const sendSOS = async () => {
    setIsSending(true);
    Vibration.vibrate([0, 500, 200, 500, 200, 500]);

    try {
      const location = await getCurrentLocation();
      if (!location) throw new Error('position');
      const result = await sendSos(location.latitude, location.longitude, rideId);

      // Le SMS automatique n'est pas encore actif : on propose d'envoyer soi-même le message
      Alert.alert(
        '✅ Alerte envoyée à 237GO',
        'Prévenez aussi un proche : un message avec votre position est prêt.',
        [
          { text: '📲 Prévenir un proche', onPress: () => shareText(result.shareMessage, 'Alerte SOS') },
          { text: '📞 Appeler le 117', onPress: () => Linking.openURL('tel:117') },
          { text: 'Fermer', style: 'cancel' },
        ]
      );
    } catch {
      Alert.alert('Erreur', 'Impossible d\'envoyer l\'alerte (position ou connexion). Appelez le 117 directement.', [
        { text: '📞 Appeler le 117', onPress: () => Linking.openURL('tel:117') },
        { text: 'Fermer', style: 'cancel' },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.sosButton, style, isSending && styles.sending]}
      onPress={handleSOS}
      disabled={isSending}
      accessibilityLabel="Bouton SOS urgence"
      accessibilityRole="button"
      accessibilityHint="Appuyez pour envoyer une alerte d'urgence"
    >
      <Text style={styles.sosIcon}>🚨</Text>
      <Text style={styles.sosText}>{isSending ? 'Envoi...' : 'SOS'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: colors.error,
    elevation: 4,
    shadowColor: colors.error,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  sending: {
    opacity: 0.6,
  },
  sosIcon: {
    fontSize: 18,
    marginRight: spacing.xs,
  },
  sosText: {
    color: colors.error,
    fontWeight: '900',
    fontSize: typography.md,
  },
});

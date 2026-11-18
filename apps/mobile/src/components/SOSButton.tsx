import React, { useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, Alert, Vibration, Linking } from 'react-native';
import { sendSos, shareText, SosContext } from '../config/safety';
import { useLocation } from '../hooks/useLocation';
import { colors, spacing, typography } from '../theme';

interface SOSButtonProps {
  /** Service en cours (course, livraison, covoiturage, location) : rattaché à l'alerte */
  context?: SosContext;
  /** Libellé complet (« 🚨 SOS — Urgence ») ou court (« 🚨 SOS ») */
  compact?: boolean;
  style?: object;
}

/**
 * Bouton SOS réutilisable : alerte l'équipe 237GO avec la position actuelle et le service
 * en cours, puis propose de prévenir un proche (WhatsApp, SMS…) et d'appeler le 117.
 */
export default function SOSButton({ context, compact, style }: SOSButtonProps) {
  const [isSending, setIsSending] = useState(false);
  const { getCurrentLocation } = useLocation();

  const sendNow = async () => {
    setIsSending(true);
    Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    try {
      const location = await getCurrentLocation();
      if (!location) throw new Error('position');
      const result = await sendSos(location.latitude, location.longitude, context);

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

  const handleSOS = () => {
    if (isSending) return;
    Alert.alert(
      '🚨 URGENCE',
      'Envoyer une alerte SOS ?\n\nL\'équipe 237GO recevra votre position.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: '🚨 ENVOYER SOS', style: 'destructive', onPress: sendNow },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={[styles.sosButton, style, isSending && styles.sending]}
      onPress={handleSOS}
      disabled={isSending}
      accessibilityLabel="Bouton SOS urgence"
      accessibilityRole="button"
      accessibilityHint="Appuyez pour envoyer une alerte d'urgence à l'équipe 237GO"
    >
      <Text style={styles.sosText}>{isSending ? 'Envoi…' : compact ? '🚨 SOS' : '🚨 SOS — Urgence'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sosButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFEBEE',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: colors.error,
  },
  sending: { opacity: 0.6 },
  sosText: { color: colors.error, fontWeight: '900', fontSize: typography.md },
});

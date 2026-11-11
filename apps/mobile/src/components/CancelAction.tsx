import React, { useState } from 'react';
import { Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import api from '../config/api';
import { colors, spacing, typography } from '../theme';

/**
 * Bouton « Annuler » réutilisable (livraison, location, covoiturage).
 * Affiche la règle de remboursement AVANT de confirmer, puis le montant
 * réellement remboursé renvoyé par le serveur (source de vérité).
 */
interface Props {
  path: string;                 // ex. /rentals/bookings/123/cancel
  label?: string;
  ruleText: string;             // règle affichée avant confirmation
  onDone?: () => void;
}

export default function CancelAction({ path, label = 'Annuler', ruleText, onDone }: Props) {
  const [busy, setBusy] = useState(false);

  const doCancel = async () => {
    setBusy(true);
    try {
      const res = await api.patch(path);
      Alert.alert('Annulation', res.data?.message || 'Annulé.', [{ text: 'OK', onPress: onDone }]);
    } catch (error: any) {
      Alert.alert('Annulation impossible', error?.response?.data?.message || 'Réessayez plus tard.');
    } finally {
      setBusy(false);
    }
  };

  const ask = () => {
    Alert.alert(label, ruleText, [
      { text: 'Retour', style: 'cancel' },
      { text: 'Confirmer l\'annulation', style: 'destructive', onPress: doCancel },
    ]);
  };

  return (
    <TouchableOpacity
      style={[styles.btn, busy && { opacity: 0.6 }]}
      onPress={ask}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator color={colors.error} /> : <Text style={styles.text}>✕ {label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1, borderColor: colors.error, borderRadius: 12,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.sm, backgroundColor: '#fff',
  },
  text: { color: colors.error, fontWeight: '700', fontSize: typography.md },
});

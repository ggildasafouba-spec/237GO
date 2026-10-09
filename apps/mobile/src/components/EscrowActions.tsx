import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import api from '../config/api';
import { colors, spacing, typography } from '../theme';

/**
 * Composant réutilisable pour les actions d'escrow côté client :
 * - Confirmer la fin du service (libère le paiement)
 * - Signaler un problème (ouvre un litige)
 *
 * Chaque service a ses propres chemins d'API :
 *  - ride      : /rides/:id/confirm-arrival        + /rides/:id/dispute
 *  - delivery  : /deliveries/:id/confirm-reception  + /deliveries/:id/dispute
 *  - carpool   : /carpools/:id/confirm-arrival      + /carpools/:id/dispute
 *  - rental    : /rentals/bookings/:id/confirm-return + /rentals/bookings/:id/dispute
 *  - market    : /market/orders/:id/confirm-reception + /market/orders/:id/dispute
 */

type ServiceType = 'ride' | 'delivery' | 'carpool' | 'rental' | 'market';

const CONFIG: Record<ServiceType, { confirmPath: (id: string) => string; disputePath: (id: string) => string; confirmLabel: string }> = {
  ride: {
    confirmPath: (id) => `/rides/${id}/confirm-arrival`,
    disputePath: (id) => `/rides/${id}/dispute`,
    confirmLabel: '✅ Confirmer mon arrivée',
  },
  delivery: {
    confirmPath: (id) => `/deliveries/${id}/confirm-reception`,
    disputePath: (id) => `/deliveries/${id}/dispute`,
    confirmLabel: '✅ Confirmer la réception',
  },
  carpool: {
    confirmPath: (id) => `/carpools/${id}/confirm-arrival`,
    disputePath: (id) => `/carpools/${id}/dispute`,
    confirmLabel: '✅ Confirmer mon arrivée',
  },
  rental: {
    confirmPath: (id) => `/rentals/bookings/${id}/confirm-return`,
    disputePath: (id) => `/rentals/bookings/${id}/dispute`,
    confirmLabel: '✅ Confirmer le retour',
  },
  market: {
    confirmPath: (id) => `/market/orders/${id}/confirm-reception`,
    disputePath: (id) => `/market/orders/${id}/dispute`,
    confirmLabel: '✅ Confirmer la réception',
  },
};

interface Props {
  serviceType: ServiceType;
  serviceId: string;
  amount?: number;
  onDone?: () => void;
}

export default function EscrowActions({ serviceType, serviceId, amount, onDone }: Props) {
  const [confirming, setConfirming] = useState(false);
  const cfg = CONFIG[serviceType];

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const res = await api.post(cfg.confirmPath(serviceId));
      Alert.alert('Validé ✅', res.data.message || 'Service confirmé.', [
        { text: 'OK', onPress: onDone },
      ]);
    } catch (error: any) {
      Alert.alert('Erreur', error?.response?.data?.message || 'Impossible de valider');
    } finally {
      setConfirming(false);
    }
  };

  const doDispute = async (reason: string) => {
    try {
      await api.post(cfg.disputePath(serviceId), { reason });
      Alert.alert('Litige ouvert', 'Un administrateur va examiner votre dossier. Le paiement reste bloqué en attendant.');
    } catch (error: any) {
      Alert.alert('Erreur', error?.response?.data?.message || 'Impossible d\'ouvrir le litige');
    }
  };

  const handleDispute = () => {
    // iOS : saisie du motif. Android : confirmation avec motif générique.
    if (Alert.prompt) {
      Alert.prompt('Signaler un problème', 'Décrivez le problème rencontré :', (reason?: string) => {
        if (reason) doDispute(reason);
      });
    } else {
      Alert.alert('Signaler un problème', 'Confirmer l\'ouverture d\'un litige ?', [
        { text: 'Annuler' },
        { text: 'Ouvrir le litige', style: 'destructive', onPress: () => doDispute('Problème signalé par le client') },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      {amount !== undefined && (
        <Text style={styles.amount}>Montant protégé : {amount.toLocaleString()} XAF</Text>
      )}
      <Text style={styles.info}>
        Le paiement est protégé. Confirmez pour le libérer au prestataire, ou signalez un problème.
      </Text>

      <TouchableOpacity
        style={[styles.confirmBtn, confirming && styles.disabled]}
        onPress={handleConfirm}
        disabled={confirming}
        accessibilityRole="button"
      >
        {confirming ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>{cfg.confirmLabel}</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.disputeBtn} onPress={handleDispute} accessibilityRole="button">
        <Text style={styles.disputeText}>⚠️ Signaler un problème</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.lg, marginTop: spacing.md },
  amount: { fontSize: typography.lg, fontWeight: '800', color: colors.primary, marginBottom: spacing.xs },
  info: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 20 },
  confirmBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 12, alignItems: 'center' },
  confirmText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  disputeBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.error, padding: spacing.md, borderRadius: 12, alignItems: 'center', marginTop: spacing.sm },
  disputeText: { color: colors.error, fontSize: typography.md, fontWeight: '700' },
});

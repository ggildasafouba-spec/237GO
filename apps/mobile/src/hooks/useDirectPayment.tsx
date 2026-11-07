import React, { useRef, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import api from '../config/api';
import { useAuthStore } from '../store/authStore';
import { colors, spacing, typography } from '../theme';

/**
 * PAIEMENT DIRECT ORANGE MONEY / MTN MOMO (via CinetPay)
 *
 * Fonctionnement :
 *  1. on crée un paiement du montant EXACT du service (page sécurisée CinetPay) ;
 *  2. le client paie avec Orange Money ou MTN sur cette page ;
 *  3. dès que CinetPay confirme, le montant est crédité sur le portefeuille 237GO ;
 *  4. l'écran appelant passe alors la commande en "Portefeuille" : l'argent est bloqué
 *     en séquestre comme pour tout paiement 237GO.
 *
 * Ainsi, aucun service n'est jamais commandé sans que l'argent ait été RÉELLEMENT reçu.
 * Si le client paie mais n'achève pas sa commande, l'argent reste sur son portefeuille
 * (utilisable ou retirable) : il n'est jamais perdu.
 */

export type DirectMethod = 'ORANGE_MONEY' | 'MTN_MOMO';
export type DirectPaymentResult = 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';

export const isDirectMethod = (m: string): m is DirectMethod =>
  m === 'ORANGE_MONEY' || m === 'MTN_MOMO';

// Options "paiement direct" à afficher dans les écrans de commande
export const DIRECT_PAYMENT_OPTIONS = [
  { id: 'ORANGE_MONEY', name: 'Orange Money', icon: '🟠' },
  { id: 'MTN_MOMO', name: 'MTN MoMo', icon: '🟡' },
];

const POLL_INTERVAL_MS = 4000;
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useDirectPayment() {
  const { user } = useAuthStore();
  const [visible, setVisible] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [amountShown, setAmountShown] = useState(0);
  const [methodShown, setMethodShown] = useState<DirectMethod>('ORANGE_MONEY');
  const cancelledRef = useRef(false);
  const busyRef = useRef(false);

  /**
   * Lance le paiement direct et attend la confirmation.
   * Lève une erreur si le paiement ne peut pas être initié (passerelle indisponible...).
   */
  const pay = useCallback(
    async (amount: number, method: DirectMethod): Promise<DirectPaymentResult> => {
      if (busyRef.current) return 'CANCELLED';
      busyRef.current = true;
      cancelledRef.current = false;

      // Mobile Money impose des montants multiples de 5 : on arrondit AU-DESSUS
      // pour que le montant crédité couvre toujours le prix du service.
      const payAmount = Math.ceil(amount / 5) * 5;

      // Numéro camerounais connu : pré-rempli. Sinon le client le saisit sur la page CinetPay.
      const phone = user?.phone && /^6[0-9]{8}$/.test(user.phone) ? user.phone : undefined;

      try {
        const res = await api.post('/wallet/deposit', {
          amount: payAmount,
          paymentMethod: method,
          phone,
          purpose: 'SERVICE',
        });
        const { transactionId, paymentUrl: url } = res.data.data;

        setAmountShown(payAmount);
        setMethodShown(method);
        setPaymentUrl(url || null);
        setVisible(true);

        if (url) {
          await Linking.openURL(url).catch(() => {
            /* le bouton "Ouvrir la page de paiement" reste disponible dans la fenêtre */
          });
        }

        // Attente de la confirmation : on interroge le serveur, qui vérifie auprès de CinetPay.
        const startedAt = Date.now();
        while (Date.now() - startedAt < MAX_WAIT_MS) {
          if (cancelledRef.current) return 'CANCELLED';
          await sleep(POLL_INTERVAL_MS);
          if (cancelledRef.current) return 'CANCELLED';
          try {
            const v = await api.post(`/wallet/verify/${transactionId}`);
            const status = v.data?.data?.status;
            if (status === 'COMPLETED') return 'COMPLETED';
            if (status === 'FAILED') return 'FAILED';
          } catch {
            // Réseau instable : on réessaie au tour suivant
          }
        }
        return 'TIMEOUT';
      } finally {
        setVisible(false);
        setPaymentUrl(null);
        busyRef.current = false;
      }
    },
    [user?.phone]
  );

  const overlay = (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { cancelledRef.current = true; }}>
      <View style={styles.backdrop}>
        <View style={styles.box} accessibilityViewIsModal>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.title}>Paiement en cours</Text>
          <Text style={styles.amount}>
            {amountShown.toLocaleString()} XAF · {methodShown === 'ORANGE_MONEY' ? 'Orange Money' : 'MTN MoMo'}
          </Text>
          <Text style={styles.text}>
            Validez le paiement sur la page sécurisée, puis revenez dans l'application.
            Votre commande sera passée automatiquement dès la confirmation.
          </Text>

          {paymentUrl && (
            <TouchableOpacity
              style={styles.openBtn}
              onPress={() => Linking.openURL(paymentUrl).catch(() => {})}
              accessibilityRole="button"
            >
              <Text style={styles.openText}>Ouvrir la page de paiement</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => { cancelledRef.current = true; }}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.note}>
            Si vous avez déjà payé, l'argent n'est pas perdu : il sera crédité sur votre portefeuille 237GO.
          </Text>
        </View>
      </View>
    </Modal>
  );

  return { pay, overlay };
}

/** Message à afficher selon le résultat (quand le paiement n'a pas abouti). */
export function directPaymentFailureMessage(result: DirectPaymentResult): string | null {
  switch (result) {
    case 'FAILED':
      return 'Le paiement a échoué ou a été refusé. Aucune commande n\'a été passée.';
    case 'TIMEOUT':
      return 'Le paiement n\'a pas encore été confirmé. Aucune commande n\'a été passée. ' +
        'Si vous avez payé, le montant apparaîtra sur votre portefeuille et vous pourrez commander avec.';
    case 'CANCELLED':
      return 'Paiement annulé. Aucune commande n\'a été passée. ' +
        'Si vous aviez déjà payé, le montant sera crédité sur votre portefeuille.';
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  box: { backgroundColor: '#fff', borderRadius: 16, padding: spacing.xl, width: '100%', maxWidth: 420, alignItems: 'center' },
  title: { fontSize: typography.lg, fontWeight: '800', color: colors.text, marginTop: spacing.md },
  amount: { fontSize: typography.md, fontWeight: '700', color: colors.primary, marginTop: spacing.xs },
  text: { fontSize: typography.sm, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md, lineHeight: 20 },
  openBtn: { backgroundColor: colors.primary, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: 12, marginTop: spacing.lg, width: '100%', alignItems: 'center' },
  openText: { color: '#fff', fontWeight: '700', fontSize: typography.md },
  cancelBtn: { paddingVertical: spacing.md, marginTop: spacing.sm, width: '100%', alignItems: 'center' },
  cancelText: { color: colors.error, fontWeight: '700', fontSize: typography.md },
  note: { fontSize: typography.xs, color: colors.textLight, textAlign: 'center', marginTop: spacing.sm },
});

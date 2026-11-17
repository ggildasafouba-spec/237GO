import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import api from '../config/api';
import { useAuthStore } from '../store/authStore';
import { useSafeScreen } from '../hooks/useSafeScreen';
import { colors, spacing, typography } from '../theme';
import { openWhatsAppSupport } from '../config/legal';

interface Blocker { code: string; message: string }

export default function DeleteAccountScreen({ navigation }: { navigation: any }) {
  const safe = useSafeScreen();
  const { logout } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [smallBalance, setSmallBalance] = useState(0);
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [forfeit, setForfeit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const check = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/auth/delete-account/check');
      setBlockers(res.data.data.blockers || []);
      setSmallBalance(res.data.data.smallBalance || 0);
    } catch {
      setLoadError('Impossible de vérifier votre compte. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { check(); }, []);

  const canSubmit = understood && password.length > 0 && (smallBalance === 0 || forfeit) && !deleting;

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.post('/auth/delete-account', { password, forfeitBalance: smallBalance > 0 ? forfeit : undefined });
      Alert.alert('Compte supprimé', 'Votre compte a été supprimé. Merci d\'avoir utilisé 237GO.');
      await logout();
    } catch (error: any) {
      const data = error?.response?.data;
      if (data?.data?.blockers) setBlockers(data.data.blockers);
      Alert.alert('Suppression impossible', data?.message || 'Vérifiez votre connexion et réessayez.');
    } finally {
      setDeleting(false);
    }
  };

  const confirm = () => {
    Alert.alert(
      'Supprimer définitivement ?',
      'Votre compte sera supprimé immédiatement. Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: doDelete },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={[safe.topBottom, { paddingBottom: spacing.xl * 2 }]} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Retour" accessibilityRole="button">
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Supprimer mon compte</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ce qui sera supprimé</Text>
        <Text style={styles.item}>• Votre nom, numéro de téléphone, email et photo</Text>
        <Text style={styles.item}>• Vos documents (permis, CNI, carte grise…) et vos contacts d'urgence</Text>
        <Text style={styles.item}>• Votre boutique, vos véhicules et votre profil chauffeur, retirés de l'app</Text>
        <Text style={[styles.cardTitle, { marginTop: spacing.md }]}>Ce qui est conservé, de façon anonyme</Text>
        <Text style={styles.item}>• L'historique des courses, commandes et paiements, sans votre nom (comptabilité et obligations légales)</Text>
        <Text style={styles.note}>Vous pourrez recréer un compte plus tard avec le même numéro.</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : loadError ? (
        <View style={styles.blockCard}>
          <Text style={styles.blockText}>{loadError}</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={check} accessibilityRole="button">
            <Text style={styles.secondaryBtnText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : blockers.length > 0 ? (
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>⏳ Pas encore possible</Text>
          {blockers.map((b) => (
            <Text key={b.code} style={styles.blockText}>• {b.message}</Text>
          ))}
          <TouchableOpacity style={styles.secondaryBtn} onPress={check} accessibilityRole="button">
            <Text style={styles.secondaryBtnText}>Vérifier à nouveau</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openWhatsAppSupport('Bonjour 237GO, je souhaite supprimer mon compte : ')} accessibilityRole="link">
            <Text style={styles.link}>Besoin d'aide ? Contacter le support</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          {smallBalance > 0 && (
            <TouchableOpacity style={styles.checkRow} onPress={() => setForfeit(!forfeit)} accessibilityRole="checkbox" accessibilityState={{ checked: forfeit }}>
              <View style={[styles.checkbox, forfeit && styles.checkboxOn]}>{forfeit && <Text style={styles.tick}>✓</Text>}</View>
              <Text style={styles.checkText}>
                Il reste {Math.floor(smallBalance)} F sur mon portefeuille, moins que le minimum de retrait (500 F). J'y renonce.
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.checkRow} onPress={() => setUnderstood(!understood)} accessibilityRole="checkbox" accessibilityState={{ checked: understood }}>
            <View style={[styles.checkbox, understood && styles.checkboxOn]}>{understood && <Text style={styles.tick}>✓</Text>}</View>
            <Text style={styles.checkText}>Je comprends que la suppression est définitive.</Text>
          </TouchableOpacity>

          <Text style={styles.label}>Confirmez avec votre mot de passe</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Mot de passe"
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Mot de passe"
          />

          <TouchableOpacity
            style={[styles.deleteBtn, !canSubmit && { opacity: 0.4 }]}
            onPress={confirm}
            disabled={!canSubmit}
            accessibilityRole="button"
          >
            {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteBtnText}>Supprimer définitivement mon compte</Text>}
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  back: { fontSize: 26, fontWeight: '700', color: colors.text },
  title: { fontSize: typography.lg, fontWeight: '800', color: colors.text },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: spacing.md, marginBottom: spacing.md },
  cardTitle: { fontSize: typography.md, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  item: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 4, lineHeight: 20 },
  note: { fontSize: typography.xs, color: colors.textSecondary, marginTop: spacing.md, fontStyle: 'italic' },
  blockCard: { backgroundColor: '#FFF4E5', borderRadius: 14, padding: spacing.md, borderWidth: 1, borderColor: '#F5C27A' },
  blockTitle: { fontSize: typography.md, fontWeight: '800', color: '#7A4A00', marginBottom: spacing.xs },
  blockText: { fontSize: typography.sm, color: '#7A4A00', marginTop: 4, lineHeight: 20 },
  secondaryBtn: { marginTop: spacing.md, backgroundColor: '#fff', borderRadius: 10, padding: spacing.sm + 2, alignItems: 'center', borderWidth: 1, borderColor: '#F5C27A' },
  secondaryBtnText: { fontWeight: '700', color: '#7A4A00' },
  link: { marginTop: spacing.md, textAlign: 'center', color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.error, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  checkboxOn: { backgroundColor: colors.error },
  tick: { color: '#fff', fontWeight: '900' },
  checkText: { flex: 1, fontSize: typography.sm, color: colors.text, lineHeight: 20 },
  label: { fontSize: typography.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  input: { backgroundColor: colors.background, borderRadius: 10, padding: spacing.md, fontSize: typography.md, borderWidth: 1, borderColor: colors.border, color: colors.text },
  deleteBtn: { marginTop: spacing.lg, backgroundColor: colors.error, borderRadius: 12, padding: spacing.md, alignItems: 'center' },
  deleteBtnText: { color: '#fff', fontWeight: '800', fontSize: typography.md },
});

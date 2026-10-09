import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import api from '../config/api';
import { colors, spacing, typography } from '../theme';

export default function ForgotPasswordScreen({ navigation }: { navigation: any }) {
  const [step, setStep] = useState<'phone' | 'reset'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleRequestOtp = async () => {
    if (!phone.match(/^6[0-9]{8}$/)) {
      Alert.alert('Numéro invalide', 'Format attendu : 6XXXXXXXX');
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.post('/auth/forgot-password', { phone });
      Alert.alert('Code envoyé', res.data.message);
      setStep('reset');
    } catch (error: any) {
      Alert.alert('Erreur', error?.response?.data?.message || 'Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    if (otp.length !== 6) {
      Alert.alert('Code invalide', 'Entrez le code à 6 chiffres reçu par SMS');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Mot de passe trop court', 'Minimum 6 caractères');
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.post('/auth/reset-password', { phone, otp, newPassword });
      Alert.alert('Succès ✅', res.data.message, [
        { text: 'Se connecter', onPress: () => navigation.goBack() },
      ]);
    } catch (error: any) {
      Alert.alert('Erreur', error?.response?.data?.message || 'Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.icon}>🔑</Text>
        <Text style={styles.title}>Mot de passe oublié</Text>

        {step === 'phone' ? (
          <>
            <Text style={styles.subtitle}>
              Entrez votre numéro de téléphone. Nous vous enverrons un code de réinitialisation par SMS.
            </Text>

            <View style={styles.phoneContainer}>
              <View style={styles.phonePrefix}>
                <Text style={styles.phonePrefixText}>🇨🇲 +237</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder="6XXXXXXXX"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                maxLength={9}
                placeholderTextColor={colors.textLight}
              />
            </View>

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleRequestOtp}
              disabled={isLoading}
            >
              {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Envoyer le code</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              Entrez le code reçu par SMS au +237 {phone} et choisissez un nouveau mot de passe.
            </Text>

            <Text style={styles.label}>Code de vérification</Text>
            <TextInput
              style={styles.input}
              placeholder="123456"
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
              placeholderTextColor={colors.textLight}
            />

            <Text style={styles.label}>Nouveau mot de passe</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Nouveau mot de passe"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showPassword}
                placeholderTextColor={colors.textLight}
              />
              <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleReset}
              disabled={isLoading}
            >
              {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Réinitialiser</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkButton} onPress={handleRequestOtp}>
              <Text style={styles.linkText}>Renvoyer le code</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.linkButton} onPress={() => navigation.goBack()}>
          <Text style={styles.linkText}>← Retour à la connexion</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  icon: { fontSize: 56, textAlign: 'center', marginBottom: spacing.sm },
  title: { fontSize: typography.xxl, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { fontSize: typography.sm, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: spacing.lg, lineHeight: 20 },
  label: { fontSize: typography.sm, fontWeight: '600', color: '#fff', marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, fontSize: typography.md },
  phoneContainer: { flexDirection: 'row', marginBottom: spacing.md },
  phonePrefix: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, marginRight: spacing.sm, justifyContent: 'center' },
  phonePrefixText: { fontSize: typography.sm, color: colors.text, fontWeight: '600' },
  phoneInput: { flex: 1, backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, fontSize: typography.md },
  passwordContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12 },
  passwordInput: { flex: 1, padding: spacing.md, fontSize: typography.md },
  eyeButton: { padding: spacing.md },
  eyeIcon: { fontSize: 18 },
  button: { backgroundColor: colors.secondary, padding: spacing.md + 2, borderRadius: 12, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  linkButton: { alignItems: 'center', marginTop: spacing.md },
  linkText: { color: 'rgba(255,255,255,0.9)', fontSize: typography.sm, fontWeight: '600' },
});

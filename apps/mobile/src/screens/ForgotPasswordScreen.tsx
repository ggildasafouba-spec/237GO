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
  Linking,
} from 'react-native';
import api from '../config/api';
import { useSafeScreen } from '../hooks/useSafeScreen';
import { colors, spacing, typography } from '../theme';

const COUNTRIES = [
  { code: '+237', flag: '🇨🇲', name: 'Cameroun' },
  { code: '+33', flag: '🇫🇷', name: 'France' },
  { code: '+32', flag: '🇧🇪', name: 'Belgique' },
  { code: '+1', flag: '🇺🇸', name: 'USA / Canada' },
  { code: '+44', flag: '🇬🇧', name: 'Royaume-Uni' },
  { code: '+49', flag: '🇩🇪', name: 'Allemagne' },
  { code: '+41', flag: '🇨🇭', name: 'Suisse' },
  { code: '+39', flag: '🇮🇹', name: 'Italie' },
  { code: '+34', flag: '🇪🇸', name: 'Espagne' },
  { code: '+971', flag: '🇦🇪', name: 'Émirats' },
  { code: '+86', flag: '🇨🇳', name: 'Chine' },
];

export default function ForgotPasswordScreen({ navigation }: { navigation: any }) {
  const safe = useSafeScreen();
  const [step, setStep] = useState<'phone' | 'support' | 'reset'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  // Le code n'est JAMAIS affiché : il arrive par email, SMS, ou via le support WhatsApp
  const [channel, setChannel] = useState<'email' | 'sms' | 'support' | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [supportWhatsapp, setSupportWhatsapp] = useState('+33650222474');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dialCode, setDialCode] = useState('+237');
  const [showCountryList, setShowCountryList] = useState(false);
  const [byEmail, setByEmail] = useState(false);
  const [emailValue, setEmailValue] = useState('');

  const selectedCountry = COUNTRIES.find((c) => c.code === dialCode) || COUNTRIES[0];
  const isCameroon = dialCode === '+237';

  // Numéro complet : Cameroun = 6XXXXXXXX tel quel ; sinon indicatif + numéro local
  const fullPhone = () => {
    if (isCameroon) return phone.trim();
    return `${dialCode}${phone.replace(/\D/g, '')}`;
  };

  // Identifiant envoyé au backend : email ou numéro complet
  const getIdentifier = () => (byEmail ? emailValue.trim().toLowerCase() : fullPhone());

  const handleRequestOtp = async () => {
    const id = getIdentifier();
    if (byEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) {
        Alert.alert('Email invalide', 'Veuillez entrer une adresse email valide.');
        return;
      }
    } else {
      const valid = isCameroon ? /^6[0-9]{8}$/.test(id) : /^\+[1-9][0-9]{6,14}$/.test(id);
      if (!valid) {
        Alert.alert('Numéro invalide', isCameroon ? 'Format attendu : 6XXXXXXXX' : 'Entrez votre numéro local (indicatif ajouté automatiquement).');
        return;
      }
    }
    setIsLoading(true);
    try {
      const res = await api.post('/auth/forgot-password', { identifier: id });
      const data = res.data?.data || {};
      if (data.supportWhatsapp) setSupportWhatsapp(data.supportWhatsapp);
      setOtp('');
      if (data.channel === 'email' || data.channel === 'sms') {
        setChannel(data.channel);
        setSentTo(data.maskedEmail || data.maskedPhone || '');
        setStep('reset');
      } else {
        // Pas d'email sur le compte : le support envoie le code par WhatsApp
        setChannel('support');
        setStep('support');
      }
    } catch (error: any) {
      Alert.alert('Erreur', error?.response?.data?.message || 'Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  // Ouvre WhatsApp avec un message prêt à envoyer au support
  const openWhatsapp = () => {
    const digits = supportWhatsapp.replace(/\D/g, '');
    const text = `Bonjour, j'ai oublié mon mot de passe 237GO. Le numéro de mon compte est : ${getIdentifier()}`;
    Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`).catch(() =>
      Alert.alert('Support 237GO', `Écrivez-nous sur WhatsApp au ${supportWhatsapp}`)
    );
  };

  const handleReset = async () => {
    if (!/^\d{6}$/.test(otp)) {
      Alert.alert('Code invalide', 'Entrez le code à 6 chiffres que vous avez reçu');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Mot de passe trop court', 'Minimum 8 caractères');
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.post('/auth/reset-password', { identifier: getIdentifier(), otp, newPassword });
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
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: safe.insets.top + spacing.xl, paddingBottom: safe.insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.icon}>🔑</Text>
        <Text style={styles.title}>Mot de passe oublié</Text>

        {step === 'phone' ? (
          <>
            <Text style={styles.subtitle}>
              {byEmail
                ? 'Entrez votre email. Nous vous enverrons un code de réinitialisation par email.'
                : 'Entrez le numéro de votre compte. Le code sera envoyé à l\'email lié à votre compte (sinon, le support 237GO vous aidera sur WhatsApp).'}
            </Text>

            {byEmail ? (
              <TextInput
                style={styles.input}
                placeholder="Votre email"
                value={emailValue}
                onChangeText={setEmailValue}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={colors.textLight}
              />
            ) : (
              <>
                <View style={styles.phoneContainer}>
                  <TouchableOpacity
                    style={styles.phonePrefix}
                    onPress={() => setShowCountryList(!showCountryList)}
                    accessibilityRole="button"
                    accessibilityLabel="Choisir l'indicatif du pays"
                  >
                    <Text style={styles.phonePrefixText}>{selectedCountry.flag} {selectedCountry.code} ▾</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder={isCameroon ? '6XXXXXXXX' : 'Numéro local'}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    maxLength={isCameroon ? 9 : 15}
                    placeholderTextColor={colors.textLight}
                  />
                </View>

                {showCountryList && (
                  <View style={styles.countryList}>
                    {COUNTRIES.map((c) => (
                      <TouchableOpacity
                        key={c.code}
                        style={styles.countryItem}
                        onPress={() => { setDialCode(c.code); setShowCountryList(false); setPhone(''); }}
                        accessibilityRole="button"
                        accessibilityLabel={`${c.name} ${c.code}`}
                      >
                        <Text style={styles.countryItemText}>{c.flag}  {c.name}</Text>
                        <Text style={styles.countryItemCode}>{c.code}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            <TouchableOpacity
              onPress={() => { setByEmail(!byEmail); setShowCountryList(false); }}
              style={styles.linkButton}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>
                {byEmail ? '📱 Utiliser mon numéro de téléphone' : '📧 Utiliser mon email'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleRequestOtp}
              disabled={isLoading}
            >
              {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Envoyer le code</Text>}
            </TouchableOpacity>
          </>
        ) : step === 'support' ? (
          <>
            <View style={styles.otpBox}>
              <Text style={styles.otpBoxLabel}>💬 Récupération par le support</Text>
              <Text style={styles.supportText}>
                Aucun email n'est lié à ce compte. Écrivez au support 237GO sur WhatsApp{' '}
                <Text style={{ fontWeight: '800' }}>depuis le numéro de votre compte</Text> : nous vérifierons
                qu'il s'agit bien de vous, puis nous vous enverrons un code.
              </Text>
              <Text style={styles.otpBoxNote}>Pour votre sécurité, aucun code n'est envoyé à un autre numéro.</Text>
            </View>

            <TouchableOpacity style={styles.button} onPress={openWhatsapp} accessibilityRole="button" accessibilityLabel="Contacter le support sur WhatsApp">
              <Text style={styles.buttonText}>💬 Contacter le support WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkButton} onPress={() => setStep('reset')} accessibilityRole="button">
              <Text style={styles.linkText}>J'ai reçu mon code →</Text>
            </TouchableOpacity>
            <Text style={styles.tip}>
              💡 Après la récupération, ajoutez un email dans votre profil : vous pourrez ensuite récupérer votre compte vous-même.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              {channel === 'email'
                ? `Un code à 6 chiffres a été envoyé à ${sentTo}. Pensez à regarder dans les courriers indésirables (spam).`
                : channel === 'sms'
                  ? `Un code à 6 chiffres a été envoyé par SMS au ${sentTo}.`
                  : 'Saisissez le code envoyé par le support 237GO et choisissez un nouveau mot de passe.'}
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
                placeholder="Nouveau mot de passe (8 caractères min.)"
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

            {channel === 'support' ? (
              <TouchableOpacity style={styles.linkButton} onPress={openWhatsapp}>
                <Text style={styles.linkText}>💬 Recontacter le support</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.linkButton} onPress={handleRequestOtp}>
                <Text style={styles.linkText}>Renvoyer le code</Text>
              </TouchableOpacity>
            )}
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
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, width: '100%', maxWidth: 460, alignSelf: 'center' },
  icon: { fontSize: 56, textAlign: 'center', marginBottom: spacing.sm },
  title: { fontSize: typography.xxl, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { fontSize: typography.sm, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: spacing.lg, lineHeight: 20 },
  label: { fontSize: typography.sm, fontWeight: '600', color: '#fff', marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, fontSize: typography.md, color: colors.text },
  phoneContainer: { flexDirection: 'row', marginBottom: spacing.md },
  phonePrefix: { backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, marginRight: spacing.sm, justifyContent: 'center' },
  phonePrefixText: { fontSize: typography.sm, color: colors.text, fontWeight: '600' },
  phoneInput: { flex: 1, backgroundColor: '#fff', padding: spacing.md, borderRadius: 12, fontSize: typography.md, color: colors.text },
  countryList: { backgroundColor: '#fff', borderRadius: 12, marginBottom: spacing.md, overflow: 'hidden' },
  countryItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  countryItemText: { fontSize: typography.sm, color: colors.text, fontWeight: '500' },
  countryItemCode: { fontSize: typography.sm, color: colors.textSecondary, fontWeight: '700' },
  passwordContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12 },
  passwordInput: { flex: 1, padding: spacing.md, fontSize: typography.md, color: colors.text },
  eyeButton: { padding: spacing.md },
  eyeIcon: { fontSize: 18 },
  button: { backgroundColor: colors.secondary, padding: spacing.md + 2, borderRadius: 12, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  linkButton: { alignItems: 'center', marginTop: spacing.md },
  linkText: { color: 'rgba(255,255,255,0.9)', fontSize: typography.sm, fontWeight: '600' },
  // Encadré code OTP affiché à l'écran
  otpBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.secondary,
  },
  otpBoxLabel: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  otpBoxCode: {
    fontSize: 42,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 8,
    marginBottom: spacing.xs,
  },
  otpBoxNote: {
    fontSize: typography.xs,
    color: colors.textLight,
    textAlign: 'center',
  },
  supportText: {
    fontSize: typography.sm,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  tip: {
    fontSize: typography.xs,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 18,
  },
});

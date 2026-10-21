import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../store/authStore';
import Logo from '../components/Logo';
import { useSafeScreen } from '../hooks/useSafeScreen';
import { colors, spacing, typography, gradients } from '../theme';

export default function LoginScreen({ navigation }: { navigation: any }) {
  const safe = useSafeScreen();
  const [isLogin, setIsLogin] = useState(true);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [accountType, setAccountType] = useState<'PASSENGER' | 'DRIVER' | 'MERCHANT'>('PASSENGER');
  const [isInternational, setIsInternational] = useState(false);
  const [countryDialCode, setCountryDialCode] = useState('+33'); // indicatif par défaut à l'étranger (France)
  const [showCountryList, setShowCountryList] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const accountTypes = [
    { id: 'PASSENGER' as const, label: 'Passager', icon: '🧍' },
    { id: 'DRIVER' as const, label: 'Chauffeur', icon: '🚗' },
    { id: 'MERCHANT' as const, label: 'Marchand', icon: '🏪' },
  ];

  // Indicatifs des pays fréquents de la diaspora camerounaise
  const countries = [
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
    { code: '+237', flag: '🇨🇲', name: 'Cameroun' },
  ];
  const selectedCountry = countries.find((c) => c.code === countryDialCode) || countries[0];

  // Construit le numéro complet à envoyer au backend :
  // - Cameroun : 6XXXXXXXX tel quel
  // - International : indicatif pays + numéro local (sans le +237), chiffres uniquement après le +
  const buildFullPhone = () => {
    if (!isInternational) return phone.trim();
    const local = phone.replace(/\D/g, ''); // garder seulement les chiffres du numéro local
    return `${countryDialCode}${local}`;
  };

  const { login, register } = useAuthStore();

  const handleSubmit = async () => {
    if (!phone || !password) {
      Alert.alert('Attention', 'Veuillez remplir tous les champs');
      return;
    }

    const fullPhone = buildFullPhone();

    // Accepte le format camerounais (6XXXXXXXX) ou international (+indicatif...)
    if (!fullPhone.match(/^(6[0-9]{8}|\+[1-9][0-9]{6,14})$/)) {
      Alert.alert('Erreur', 'Numéro invalide. Format camerounais 6XXXXXXXX, ou international (indicatif + numéro).');
      return;
    }

    setIsLoading(true);
    try {
      if (isLogin) {
        await login(fullPhone, password);
      } else {
        if (!firstName || !lastName) {
          Alert.alert('Attention', 'Veuillez entrer votre nom et prénom');
          setIsLoading(false);
          return;
        }
        // Email : obligatoire pour la diaspora (mode international), optionnel sinon
        const trimmedEmail = email.trim();
        if (isInternational && !trimmedEmail) {
          Alert.alert('Email requis', 'Depuis l\'étranger, un email est nécessaire (pour la récupération de compte).');
          setIsLoading(false);
          return;
        }
        if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
          Alert.alert('Email invalide', 'Veuillez entrer une adresse email valide.');
          setIsLoading(false);
          return;
        }
        // Le compte est créé en PASSENGER (sécurité). Si l'utilisateur a choisi
        // Chauffeur ou Marchand, on l'orientera vers le formulaire de demande
        // (validation par l'admin ensuite).
        await register({ phone: fullPhone, firstName, lastName, password, email: trimmedEmail || undefined });

        if (accountType === 'DRIVER') {
          Alert.alert(
            'Bienvenue sur 237GO ! 🚗',
            'Votre compte est créé. Pour conduire, complétez votre demande de chauffeur (documents + véhicule). Elle sera vérifiée par notre équipe.',
            [{ text: 'Compléter ma demande', onPress: () => navigation.navigate('BecomeDriver') }]
          );
        } else if (accountType === 'MERCHANT') {
          Alert.alert(
            'Bienvenue sur 237GO ! 🏪',
            'Votre compte est créé. Pour vendre, complétez votre demande de marchand. Elle sera vérifiée par notre équipe.',
            [{ text: 'Compléter ma demande', onPress: () => navigation.navigate('BecomeMerchant') }]
          );
        }
      }
    } catch (error: any) {
      // Afficher le vrai message : message backend, ou 1re erreur de validation, sinon générique
      const data = error?.response?.data;
      const message =
        data?.message ||
        (Array.isArray(data?.errors) && data.errors[0]?.msg) ||
        (error?.message === 'Network Error' ? 'Pas de connexion au serveur. Vérifiez votre internet.' : null) ||
        'Une erreur est survenue';
      Alert.alert('Erreur', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient colors={gradients.dark} style={{ flex: 1 }}>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: safe.insets.top, paddingBottom: safe.insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Logo size={110} variant="light" />
          <Text style={styles.logo}>237GO</Text>
          <Text style={styles.slogan}>On bouge ensemble 🚀</Text>
          {/* Barre aux couleurs du Cameroun : vert - rouge - jaune (avec étoile) */}
          <View style={styles.flagBar}>
            <View style={[styles.flagStripe, { backgroundColor: colors.primary }]} />
            <View style={[styles.flagStripe, { backgroundColor: colors.accent }]}>
              <Text style={styles.flagStar}>★</Text>
            </View>
            <View style={[styles.flagStripe, { backgroundColor: colors.secondary }]} />
          </View>
        </View>

        {/* Formulaire */}
        <View style={styles.form}>
          <Text style={styles.title}>{isLogin ? 'Connexion' : 'Inscription'}</Text>

          {!isLogin && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Prénom"
                value={firstName}
                onChangeText={setFirstName}
                placeholderTextColor={colors.textLight}
                accessibilityLabel="Prénom"
              />
              <TextInput
                style={styles.input}
                placeholder="Nom"
                value={lastName}
                onChangeText={setLastName}
                placeholderTextColor={colors.textLight}
                accessibilityLabel="Nom de famille"
              />

              <TextInput
                style={styles.input}
                placeholder={isInternational ? 'Email (obligatoire à l\'étranger)' : 'Email (optionnel)'}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={colors.textLight}
                accessibilityLabel="Adresse email"
              />
              {isInternational && (
                <Text style={styles.accountTypeHint}>
                  📧 Depuis l'étranger, l'email permet de récupérer votre compte (le SMS international n'est pas toujours fiable).
                </Text>
              )}

              {/* Choix du type de compte */}
              <Text style={styles.accountTypeLabel}>Je m'inscris en tant que</Text>
              <View style={styles.accountTypeRow}>
                {accountTypes.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.accountTypeChip, accountType === t.id && styles.accountTypeChipActive]}
                    onPress={() => setAccountType(t.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: accountType === t.id }}
                    accessibilityLabel={t.label}
                  >
                    <Text style={styles.accountTypeIcon}>{t.icon}</Text>
                    <Text style={[styles.accountTypeText, accountType === t.id && styles.accountTypeTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {accountType !== 'PASSENGER' && (
                <Text style={styles.accountTypeHint}>
                  Une vérification de vos documents sera requise après l'inscription.
                </Text>
              )}
            </>
          )}

          <View style={styles.phoneContainer}>
            {!isInternational ? (
              <View style={styles.phonePrefix}>
                <Text style={styles.phonePrefixText}>🇨🇲 +237</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.phonePrefix}
                onPress={() => setShowCountryList(!showCountryList)}
                accessibilityRole="button"
                accessibilityLabel="Choisir l'indicatif du pays"
              >
                <Text style={styles.phonePrefixText}>{selectedCountry.flag} {selectedCountry.code} ▾</Text>
              </TouchableOpacity>
            )}
            <TextInput
              style={styles.phoneInput}
              placeholder={isInternational ? 'Numéro local (sans indicatif)' : '6XXXXXXXX'}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={isInternational ? 15 : 9}
              placeholderTextColor={colors.textLight}
              accessibilityLabel="Numéro de téléphone"
            />
          </View>

          {/* Liste des indicatifs (mode international) */}
          {isInternational && showCountryList && (
            <View style={styles.countryList}>
              {countries.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={styles.countryItem}
                  onPress={() => { setCountryDialCode(c.code); setShowCountryList(false); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name} ${c.code}`}
                >
                  <Text style={styles.countryItemText}>{c.flag}  {c.name}</Text>
                  <Text style={styles.countryItemCode}>{c.code}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            onPress={() => { setIsInternational(!isInternational); setPhone(''); setShowCountryList(false); }}
            style={styles.intlToggle}
            accessibilityRole="button"
          >
            <Text style={styles.intlToggleText}>
              {isInternational ? '🇨🇲 J\'ai un numéro camerounais' : '🌍 Je suis à l\'étranger (numéro international)'}
            </Text>
          </TouchableOpacity>

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Mot de passe"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              placeholderTextColor={colors.textLight}
              accessibilityLabel="Mot de passe"
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
              accessibilityLabel={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            >
              <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
            accessibilityLabel={isLogin ? 'Se connecter' : "S'inscrire"}
            accessibilityRole="button"
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>
                {isLogin ? 'Se connecter' : "S'inscrire"}
              </Text>
            )}
          </TouchableOpacity>

          {isLogin && (
            <TouchableOpacity
              style={styles.forgotButton}
              onPress={() => navigation.navigate('ForgotPassword')}
              accessibilityRole="link"
              accessibilityLabel="Mot de passe oublié"
            >
              <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => setIsLogin(!isLogin)}
            accessibilityRole="link"
            accessibilityLabel={isLogin ? "Créer un compte" : "Déjà un compte ? Se connecter"}
          >
            <Text style={styles.switchText}>
              {isLogin ? "Pas de compte ? " : "Déjà un compte ? "}
              <Text style={styles.switchLink}>
                {isLogin ? "S'inscrire" : "Se connecter"}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  logoFlag: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  logo: {
    fontSize: 52,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 2,
  },
  flagBar: {
    flexDirection: 'row',
    width: 90,
    height: 30,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  flagStripe: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flagStar: {
    color: colors.secondary,
    fontSize: 16,
  },
  slogan: {
    fontSize: typography.md,
    color: 'rgba(255,255,255,0.8)',
    marginTop: spacing.xs,
  },
  form: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: spacing.xl,
    flex: 1,
  },
  title: {
    fontSize: typography.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  accountTypeLabel: {
    fontSize: typography.sm,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  accountTypeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  accountTypeChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountTypeChipActive: {
    backgroundColor: '#E8F5E9',
    borderColor: colors.primary,
  },
  accountTypeIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  accountTypeText: {
    fontSize: typography.xs,
    color: colors.text,
    fontWeight: '600',
  },
  accountTypeTextActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  accountTypeHint: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  phoneContainer: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  intlToggle: {
    marginBottom: spacing.md,
    paddingVertical: 2,
  },
  intlToggleText: {
    fontSize: typography.xs,
    color: colors.primary,
    fontWeight: '600',
  },
  phonePrefix: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
    justifyContent: 'center',
  },
  phonePrefixText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: '600',
  },
  countryList: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  countryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  countryItemText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: '500',
  },
  countryItemCode: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  phoneInput: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  passwordInput: {
    flex: 1,
    padding: spacing.md,
    fontSize: typography.md,
    color: colors.text,
  },
  eyeButton: {
    padding: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeIcon: {
    fontSize: 18,
  },
  submitButton: {
    backgroundColor: colors.primary,
    padding: spacing.md + 2,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: typography.md,
    fontWeight: '700',
  },
  forgotButton: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  forgotText: {
    color: colors.primary,
    fontSize: typography.sm,
    fontWeight: '600',
  },
  switchButton: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  switchText: {
    fontSize: typography.sm,
    color: colors.textSecondary,
  },
  switchLink: {
    color: colors.primary,
    fontWeight: '700',
  },
});

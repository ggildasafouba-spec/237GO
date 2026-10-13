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
import { colors, spacing, typography, gradients } from '../theme';

export default function LoginScreen({ navigation }: { navigation: any }) {
  const [isLogin, setIsLogin] = useState(true);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [accountType, setAccountType] = useState<'PASSENGER' | 'DRIVER' | 'MERCHANT'>('PASSENGER');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const accountTypes = [
    { id: 'PASSENGER' as const, label: 'Passager', icon: '🧍' },
    { id: 'DRIVER' as const, label: 'Chauffeur', icon: '🚗' },
    { id: 'MERCHANT' as const, label: 'Marchand', icon: '🏪' },
  ];

  const { login, register } = useAuthStore();

  const handleSubmit = async () => {
    if (!phone || !password) {
      Alert.alert('Attention', 'Veuillez remplir tous les champs');
      return;
    }

    if (!phone.match(/^6[0-9]{8}$/)) {
      Alert.alert('Erreur', 'Numéro de téléphone invalide. Format: 6XXXXXXXX');
      return;
    }

    setIsLoading(true);
    try {
      if (isLogin) {
        await login(phone, password);
      } else {
        if (!firstName || !lastName) {
          Alert.alert('Attention', 'Veuillez entrer votre nom et prénom');
          setIsLoading(false);
          return;
        }
        // Le compte est créé en PASSENGER (sécurité). Si l'utilisateur a choisi
        // Chauffeur ou Marchand, on l'orientera vers le formulaire de demande
        // (validation par l'admin ensuite).
        await register({ phone, firstName, lastName, password });

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
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
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
              accessibilityLabel="Numéro de téléphone"
            />
          </View>

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
    marginBottom: spacing.md,
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
  phoneInput: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: 12,
    fontSize: typography.md,
    borderWidth: 1,
    borderColor: colors.border,
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

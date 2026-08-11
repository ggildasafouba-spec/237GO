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
import { useAuthStore } from '../store/authStore';
import { colors, spacing, typography } from '../theme';

export default function LoginScreen({ navigation }: { navigation: any }) {
  const [isLogin, setIsLogin] = useState(true);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
        await register({ phone, firstName, lastName, password });
      }
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Une erreur est survenue';
      Alert.alert('Erreur', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Text style={styles.logo}>237GO</Text>
          <Text style={styles.slogan}>On bouge ensemble 🚀</Text>
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

          <TextInput
            style={styles.input}
            placeholder="Mot de passe"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Mot de passe"
          />

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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  logo: {
    fontSize: 48,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 2,
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

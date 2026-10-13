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
  Image,
} from 'react-native';
import api from '../config/api';
import { pickAndUploadImage } from '../config/upload';
import { colors, spacing, typography } from '../theme';

const CATEGORIES = [
  { value: 'alimentation', label: '🥬 Alimentation' },
  { value: 'restaurant', label: '🍲 Restaurant' },
  { value: 'boutique', label: '🛍️ Boutique' },
  { value: 'pharmacie', label: '💊 Pharmacie' },
  { value: 'artisanat', label: '🎨 Artisanat' },
  { value: 'autre', label: '📦 Autre' },
];

function UploadBox({ label, uri, loading, onPress, required }: { label: string; uri: string | null; loading: boolean; onPress: () => void; required?: boolean }) {
  return (
    <TouchableOpacity style={styles.uploadBox} onPress={onPress} disabled={loading} accessibilityLabel={`Téléverser ${label}`}>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : uri ? (
        <Image source={{ uri }} style={styles.uploadPreview} />
      ) : (
        <>
          <Text style={styles.uploadIcon}>📷</Text>
          <Text style={styles.uploadLabel}>{label}{required ? ' *' : ''}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export default function BecomeMerchantScreen({ navigation }: { navigation: any }) {
  const [shopName, setShopName] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [category, setCategory] = useState('alimentation');
  const [description, setDescription] = useState('');
  const [ownerIdPhoto, setOwnerIdPhoto] = useState<string | null>(null);
  const [shopPhoto, setShopPhoto] = useState<string | null>(null);
  const [businessRegPhoto, setBusinessRegPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUpload = async (which: 'ownerId' | 'shop' | 'businessReg') => {
    setUploading(which);
    try {
      const url = await pickAndUploadImage();
      if (url) {
        if (which === 'ownerId') setOwnerIdPhoto(url);
        else if (which === 'shop') setShopPhoto(url);
        else setBusinessRegPhoto(url);
      }
    } catch (error: any) {
      Alert.alert('Erreur', error?.message || 'Impossible de téléverser l\'image');
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async () => {
    if (!shopName || !shopAddress) {
      Alert.alert('Champs requis', 'Veuillez renseigner le nom et l\'adresse de la boutique.');
      return;
    }
    if (!ownerIdPhoto || !shopPhoto) {
      Alert.alert('Documents requis', 'Téléversez votre pièce d\'identité et une photo de la boutique. Le registre de commerce est optionnel.');
      return;
    }

    setIsLoading(true);
    try {
      await api.post('/users/become-merchant', {
        shopName,
        shopAddress,
        // Position par défaut (Douala) — à affiner avec le GPS plus tard
        shopLat: 4.0511,
        shopLng: 9.7679,
        category,
        description: description || undefined,
        ownerIdPhoto,
        shopPhoto,
        businessRegPhoto: businessRegPhoto || undefined,
      });

      Alert.alert(
        'Demande envoyée ✅',
        'Votre demande de marchand a été soumise. Notre équipe va vérifier vos informations. Vous serez notifié dès l\'approbation.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Une erreur est survenue';
      Alert.alert('Erreur', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.icon}>🏪</Text>
        <Text style={styles.title}>Devenir marchand</Text>
        <Text style={styles.subtitle}>
          Vendez vos produits sur 237GO. Vos informations seront vérifiées par notre équipe avant activation.
        </Text>

        <Text style={styles.label}>Nom de la boutique *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Mama Ngono - Alimentation"
          value={shopName}
          onChangeText={setShopName}
          placeholderTextColor={colors.textLight}
        />

        <Text style={styles.label}>Adresse *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Marché Mboppi, Douala"
          value={shopAddress}
          onChangeText={setShopAddress}
          placeholderTextColor={colors.textLight}
        />

        <Text style={styles.label}>Catégorie *</Text>
        <View style={styles.catGrid}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.value}
              style={[styles.catChip, category === c.value && styles.catChipActive]}
              onPress={() => setCategory(c.value)}
            >
              <Text style={[styles.catChipText, category === c.value && styles.catChipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Description (optionnel)</Text>
        <TextInput
          style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
          placeholder="Décrivez votre activité, vos produits..."
          value={description}
          onChangeText={setDescription}
          placeholderTextColor={colors.textLight}
          multiline
        />

        <Text style={styles.label}>Documents (photos)</Text>
        <Text style={styles.docHint}>Pièce d'identité et photo de la boutique obligatoires. Registre de commerce optionnel.</Text>
        <View style={styles.uploadRow}>
          <UploadBox label="Pièce d'identité" uri={ownerIdPhoto} loading={uploading === 'ownerId'} onPress={() => handleUpload('ownerId')} required />
          <UploadBox label="Boutique" uri={shopPhoto} loading={uploading === 'shop'} onPress={() => handleUpload('shop')} required />
          <UploadBox label="Registre comm." uri={businessRegPhoto} loading={uploading === 'businessReg'} onPress={() => handleUpload('businessReg')} />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>Soumettre ma demande</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingBottom: 120 },
  icon: { fontSize: 56, textAlign: 'center', marginBottom: spacing.sm },
  title: { fontSize: typography.xxl, fontWeight: '700', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: typography.sm, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 20 },
  label: { fontSize: typography.sm, fontWeight: '600', color: colors.text, marginBottom: spacing.xs, marginTop: spacing.md },
  docHint: { fontSize: typography.xs, color: colors.textSecondary, marginBottom: spacing.sm, fontStyle: 'italic' },
  input: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: 12, fontSize: typography.md, borderWidth: 1, borderColor: colors.border },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  catChip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  catChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catChipText: { fontSize: typography.sm, color: colors.text },
  catChipTextActive: { color: '#fff', fontWeight: '700' },
  uploadRow: { flexDirection: 'row', gap: spacing.sm },
  uploadBox: { flex: 1, height: 90, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  uploadPreview: { width: '100%', height: '100%' },
  uploadIcon: { fontSize: 24 },
  uploadLabel: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 4, textAlign: 'center' },
  submitButton: { backgroundColor: colors.primary, padding: spacing.md + 2, borderRadius: 12, alignItems: 'center', marginTop: spacing.xl },
  buttonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  backButton: { alignItems: 'center', marginTop: spacing.lg },
  backText: { color: colors.primary, fontSize: typography.md, fontWeight: '600' },
});

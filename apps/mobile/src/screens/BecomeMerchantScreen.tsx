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
import { useLocation } from '../hooks/useLocation';
import DestinationPicker, { PickedPlace } from '../components/DestinationPicker';
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
  const [shopLat, setShopLat] = useState(4.0511);
  const [shopLng, setShopLng] = useState(9.7679);
  const [locationLabel, setLocationLabel] = useState('');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locating, setLocating] = useState(false);
  const [category, setCategory] = useState('alimentation');
  const [description, setDescription] = useState('');
  const [ownerIdPhoto, setOwnerIdPhoto] = useState<string | null>(null);
  const [shopPhoto, setShopPhoto] = useState<string | null>(null);
  const [businessRegPhoto, setBusinessRegPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { getCurrentLocation, reverseGeocode } = useLocation();

  // Utiliser la position GPS actuelle comme position du restaurant
  const useMyLocation = async () => {
    setLocating(true);
    try {
      const loc = await getCurrentLocation();
      if (loc) {
        setShopLat(loc.latitude);
        setShopLng(loc.longitude);
        const addr = await reverseGeocode(loc.latitude, loc.longitude);
        setLocationLabel(addr);
        if (!shopAddress) setShopAddress(addr);
      } else {
        Alert.alert('Localisation', "Impossible d'obtenir votre position. Vérifiez que le GPS est activé.");
      }
    } finally {
      setLocating(false);
    }
  };

  // Position choisie sur la carte
  const onLocationPicked = (place: PickedPlace) => {
    setShopLat(place.lat);
    setShopLng(place.lng);
    setLocationLabel(place.label);
    if (!shopAddress) setShopAddress(place.label);
    setShowLocationPicker(false);
  };

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
        shopLat,
        shopLng,
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

        {/* Localisation GPS du restaurant */}
        <Text style={styles.label}>Position sur la carte *</Text>
        <Text style={styles.docHint}>
          Indispensable pour que les clients vous trouvent et que les chauffeurs viennent livrer.
        </Text>

        {/* Affichage de la position choisie */}
        {locationLabel ? (
          <View style={styles.locationChosen}>
            <Text style={styles.locationChosenIcon}>📍</Text>
            <Text style={styles.locationChosenText} numberOfLines={2}>{locationLabel}</Text>
          </View>
        ) : (
          <View style={styles.locationEmpty}>
            <Text style={styles.locationEmptyText}>⚠️ Aucune position choisie</Text>
          </View>
        )}

        {/* Boutons de géolocalisation */}
        <View style={styles.locationButtons}>
          <TouchableOpacity
            style={styles.locationBtn}
            onPress={useMyLocation}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel="Utiliser ma position actuelle"
          >
            {locating ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.locationBtnText}>📡 Ma position</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.locationBtn, styles.locationBtnMap]}
            onPress={() => setShowLocationPicker(true)}
            accessibilityRole="button"
            accessibilityLabel="Choisir sur la carte"
          >
            <Text style={[styles.locationBtnText, { color: '#fff' }]}>🗺️ Choisir sur la carte</Text>
          </TouchableOpacity>
        </View>

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

      {/* Sélecteur de position sur la carte */}
      <DestinationPicker
        visible={showLocationPicker}
        initialCenter={{ lat: shopLat, lng: shopLng }}
        title="Position du restaurant / boutique"
        onConfirm={onLocationPicked}
        onClose={() => setShowLocationPicker(false)}
      />
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
  // Localisation GPS
  locationChosen: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F5E9',
    borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.primary,
  },
  locationChosenIcon: { fontSize: 20, marginRight: spacing.sm },
  locationChosenText: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: '500' },
  locationEmpty: {
    backgroundColor: '#FFF8E1', borderRadius: 12, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: '#FCD116',
    alignItems: 'center',
  },
  locationEmptyText: { fontSize: typography.sm, color: '#B8860B', fontWeight: '600' },
  locationButtons: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  locationBtn: {
    flex: 1, padding: spacing.md, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: colors.primary,
  },
  locationBtnMap: { backgroundColor: colors.primary, borderColor: colors.primary },
  locationBtnText: { fontSize: typography.sm, fontWeight: '700', color: colors.primary },
});

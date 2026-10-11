import React, { useState, useEffect } from 'react';
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
  Switch,
} from 'react-native';
import api from '../config/api';
import { pickAndUploadImage } from '../config/upload';
import { Image } from 'react-native';
import { colors, spacing, typography } from '../theme';

interface CategoryCriteria {
  type: string;
  label: string;
  icon: string;
  minYear: number | null;
  airConditioning: boolean;
  examples: string;
  requirements: string[];
}

// Repli si l'API n'est pas joignable (mêmes libellés que le backend)
const FALLBACK_CRITERIA: CategoryCriteria[] = [
  { type: 'MOTO', label: 'Moto', icon: '🏍️', minYear: null, airConditioning: false, examples: 'Honda, Yamaha…', requirements: ['Moto en bon état', 'Casque passager obligatoire', 'Permis + CNI valides'] },
  { type: 'CAR_ECONOMY', label: 'Éco', icon: '🚗', minYear: 2008, airConditioning: false, examples: 'Toyota Corolla, Hyundai Accent…', requirements: ['Berline 4 portes', 'Année ≥ 2008', 'Permis, CNI, carte grise, assurance, visite technique'] },
  { type: 'CAR_COMFORT', label: 'Confort', icon: '🚙', minYear: 2014, airConditioning: true, examples: 'Toyota Camry, Hyundai Elantra…', requirements: ['Berline récente', 'Année ≥ 2014', 'Climatisation obligatoire', 'Documents complets'] },
  { type: 'CAR_VIP', label: 'VIP', icon: '✨', minYear: 2018, airConditioning: true, examples: 'Mercedes, Prado, Lexus…', requirements: ['Véhicule haut de gamme', 'Année ≥ 2018', 'Clim + intérieur premium', 'Chauffeur en tenue', 'Documents complets'] },
  { type: 'TRUCK', label: 'Camion', icon: '🚚', minYear: 2005, airConditioning: false, examples: 'Camionnettes, fourgons…', requirements: ['Utilitaire en bon état', 'Documents complets'] },
];

function UploadBox({ label, uri, loading, onPress }: { label: string; uri: string | null; loading: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.uploadBox} onPress={onPress} disabled={loading} accessibilityLabel={`Téléverser ${label}`}>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : uri ? (
        <Image source={{ uri }} style={styles.uploadPreview} />
      ) : (
        <>
          <Text style={styles.uploadIcon}>📷</Text>
          <Text style={styles.uploadLabel}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export default function BecomeDriverScreen({ navigation }: { navigation: any }) {
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [cniNumber, setCniNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('MOTO');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [hasAirConditioning, setHasAirConditioning] = useState(false);
  const [licensePhoto, setLicensePhoto] = useState<string | null>(null);
  const [cniPhoto, setCniPhoto] = useState<string | null>(null);
  const [vehiclePhoto, setVehiclePhoto] = useState<string | null>(null);
  const [registrationPhoto, setRegistrationPhoto] = useState<string | null>(null);
  const [insurancePhoto, setInsurancePhoto] = useState<string | null>(null);
  const [inspectionPhoto, setInspectionPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [criteria, setCriteria] = useState<CategoryCriteria[]>(FALLBACK_CRITERIA);

  // Charger les critères depuis le backend (source de vérité)
  useEffect(() => {
    api
      .get('/users/vehicle-criteria')
      .then((res) => {
        if (Array.isArray(res.data?.data) && res.data.data.length) setCriteria(res.data.data);
      })
      .catch(() => {});
  }, []);

  const selectedCriteria = criteria.find((c) => c.type === vehicleType) || criteria[0];
  const isCar = vehicleType !== 'MOTO';

  const handleUpload = async (
    which: 'license' | 'cni' | 'vehicle' | 'registration' | 'insurance' | 'inspection'
  ) => {
    setUploading(which);
    try {
      const url = await pickAndUploadImage();
      if (url) {
        if (which === 'license') setLicensePhoto(url);
        else if (which === 'cni') setCniPhoto(url);
        else if (which === 'vehicle') setVehiclePhoto(url);
        else if (which === 'registration') setRegistrationPhoto(url);
        else if (which === 'insurance') setInsurancePhoto(url);
        else setInspectionPhoto(url);
      }
    } catch (error: any) {
      Alert.alert('Erreur', error?.message || 'Impossible de téléverser l\'image');
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async () => {
    if (!licenseNumber || !licenseExpiry || !cniNumber || !vehiclePlate) {
      Alert.alert('Champs requis', 'Veuillez remplir le permis, la date d\'expiration, la CNI et la plaque.');
      return;
    }

    // Validation simple de la date (format AAAA-MM-JJ)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry)) {
      Alert.alert('Date invalide', 'Format attendu : AAAA-MM-JJ (ex: 2028-12-31)');
      return;
    }

    // Validation des critères de catégorie (année + clim) côté client
    const year = vehicleYear ? parseInt(vehicleYear, 10) : null;
    if (selectedCriteria?.minYear) {
      if (!year) {
        Alert.alert('Année requise', `L'année du véhicule est requise pour la catégorie ${selectedCriteria.label}.`);
        return;
      }
      if (year < selectedCriteria.minYear) {
        Alert.alert('Véhicule trop ancien', `Pour la catégorie ${selectedCriteria.label}, le véhicule doit dater de ${selectedCriteria.minYear} ou plus récent.`);
        return;
      }
    }
    if (selectedCriteria?.airConditioning && !hasAirConditioning) {
      Alert.alert('Climatisation requise', `La climatisation est obligatoire pour la catégorie ${selectedCriteria.label}.`);
      return;
    }

    setIsLoading(true);
    try {
      await api.post('/users/become-driver', {
        licenseNumber,
        licenseExpiry: new Date(licenseExpiry).toISOString(),
        cniNumber,
        vehicleType,
        vehiclePlate,
        vehicleBrand: vehicleBrand || undefined,
        vehicleModel: vehicleModel || undefined,
        vehicleYear: year || undefined,
        hasAirConditioning,
        licensePhoto: licensePhoto || undefined,
        cniPhoto: cniPhoto || undefined,
        vehiclePhoto: vehiclePhoto || undefined,
        registrationPhoto: registrationPhoto || undefined,
        insurancePhoto: insurancePhoto || undefined,
        inspectionPhoto: inspectionPhoto || undefined,
      });

      Alert.alert(
        'Demande envoyée ✅',
        'Votre demande de chauffeur a été soumise. Notre équipe va vérifier vos informations. Vous serez notifié dès l\'approbation.',
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
        <Text style={styles.icon}>🚕</Text>
        <Text style={styles.title}>Devenir chauffeur</Text>
        <Text style={styles.subtitle}>
          Remplissez vos informations. Elles seront vérifiées par notre équipe avant activation.
        </Text>

        <Text style={styles.label}>Numéro de permis de conduire *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: DL-123456"
          value={licenseNumber}
          onChangeText={setLicenseNumber}
          placeholderTextColor={colors.textLight}
        />

        <Text style={styles.label}>Date d'expiration du permis *</Text>
        <TextInput
          style={styles.input}
          placeholder="AAAA-MM-JJ (ex: 2028-12-31)"
          value={licenseExpiry}
          onChangeText={setLicenseExpiry}
          placeholderTextColor={colors.textLight}
          keyboardType="numbers-and-punctuation"
        />

        <Text style={styles.label}>Numéro CNI (Carte Nationale d'Identité) *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: 123456789"
          value={cniNumber}
          onChangeText={setCniNumber}
          placeholderTextColor={colors.textLight}
        />

        <Text style={styles.label}>Documents (photos)</Text>
        <View style={styles.uploadRow}>
          <UploadBox label="Permis" uri={licensePhoto} loading={uploading === 'license'} onPress={() => handleUpload('license')} />
          <UploadBox label="CNI" uri={cniPhoto} loading={uploading === 'cni'} onPress={() => handleUpload('cni')} />
          <UploadBox label="Véhicule" uri={vehiclePhoto} loading={uploading === 'vehicle'} onPress={() => handleUpload('vehicle')} />
        </View>

        <Text style={styles.label}>Catégorie de véhicule *</Text>
        <View style={styles.vehicleGrid}>
          {criteria.map((v) => (
            <TouchableOpacity
              key={v.type}
              style={[styles.vehicleChip, vehicleType === v.type && styles.vehicleChipActive]}
              onPress={() => setVehicleType(v.type)}
            >
              <Text style={[styles.vehicleChipText, vehicleType === v.type && styles.vehicleChipTextActive]}>
                {v.icon} {v.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Exigences de la catégorie sélectionnée */}
        {selectedCriteria && (
          <View style={styles.criteriaBox}>
            <Text style={styles.criteriaTitle}>
              {selectedCriteria.icon} Exigences {selectedCriteria.label}
            </Text>
            {selectedCriteria.examples ? (
              <Text style={styles.criteriaExamples}>Ex : {selectedCriteria.examples}</Text>
            ) : null}
            {selectedCriteria.requirements.map((r, i) => (
              <Text key={i} style={styles.criteriaItem}>• {r}</Text>
            ))}
          </View>
        )}

        <Text style={styles.label}>Plaque d'immatriculation *</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: LT 1234 A"
          value={vehiclePlate}
          onChangeText={setVehiclePlate}
          placeholderTextColor={colors.textLight}
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Marque (optionnel)</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Toyota"
          value={vehicleBrand}
          onChangeText={setVehicleBrand}
          placeholderTextColor={colors.textLight}
        />

        <Text style={styles.label}>Modèle (optionnel)</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex: Corolla"
          value={vehicleModel}
          onChangeText={setVehicleModel}
          placeholderTextColor={colors.textLight}
        />

        {/* Champs spécifiques aux voitures */}
        {isCar && (
          <>
            <Text style={styles.label}>
              Année du véhicule {selectedCriteria?.minYear ? '*' : '(optionnel)'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={selectedCriteria?.minYear ? `Min ${selectedCriteria.minYear}` : 'Ex: 2016'}
              value={vehicleYear}
              onChangeText={setVehicleYear}
              placeholderTextColor={colors.textLight}
              keyboardType="number-pad"
              maxLength={4}
            />

            <View style={styles.acRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.acLabel}>Climatisation</Text>
                {selectedCriteria?.airConditioning && (
                  <Text style={styles.acHint}>Obligatoire pour {selectedCriteria.label}</Text>
                )}
              </View>
              <Switch
                value={hasAirConditioning}
                onValueChange={setHasAirConditioning}
                trackColor={{ false: '#ccc', true: colors.primaryLight }}
                thumbColor={hasAirConditioning ? colors.primary : '#f4f3f4'}
                accessibilityLabel="Climatisation"
              />
            </View>

            <Text style={styles.label}>Documents du véhicule (photos)</Text>
            <View style={styles.uploadRow}>
              <UploadBox label="Carte grise" uri={registrationPhoto} loading={uploading === 'registration'} onPress={() => handleUpload('registration')} />
              <UploadBox label="Assurance" uri={insurancePhoto} loading={uploading === 'insurance'} onPress={() => handleUpload('insurance')} />
              <UploadBox label="Visite tech." uri={inspectionPhoto} loading={uploading === 'inspection'} onPress={() => handleUpload('inspection')} />
            </View>
          </>
        )}

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
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxl },
  icon: { fontSize: 56, textAlign: 'center', marginBottom: spacing.sm },
  title: { fontSize: typography.xxl, fontWeight: '700', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: typography.sm, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 20 },
  label: { fontSize: typography.sm, fontWeight: '600', color: colors.text, marginBottom: spacing.xs, marginTop: spacing.md },
  input: { backgroundColor: colors.surface, padding: spacing.md, borderRadius: 12, fontSize: typography.md, borderWidth: 1, borderColor: colors.border },
  uploadRow: { flexDirection: 'row', gap: spacing.sm },
  uploadBox: { flex: 1, height: 90, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  uploadPreview: { width: '100%', height: '100%' },
  uploadIcon: { fontSize: 24 },
  uploadLabel: { fontSize: typography.xs, color: colors.textSecondary, marginTop: 4 },
  vehicleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  vehicleChip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  vehicleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  vehicleChipText: { fontSize: typography.sm, color: colors.text },
  vehicleChipTextActive: { color: '#fff', fontWeight: '700' },
  criteriaBox: { backgroundColor: '#E8F5E9', borderRadius: 12, padding: spacing.md, marginTop: spacing.md },
  criteriaTitle: { fontSize: typography.sm, fontWeight: '800', color: colors.primaryDark, marginBottom: 4 },
  criteriaExamples: { fontSize: typography.xs, color: colors.textSecondary, fontStyle: 'italic', marginBottom: spacing.xs },
  criteriaItem: { fontSize: typography.xs, color: colors.text, marginTop: 2 },
  acRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md },
  acLabel: { fontSize: typography.md, color: colors.text, fontWeight: '600' },
  acHint: { fontSize: typography.xs, color: colors.primary, marginTop: 2 },
  submitButton: { backgroundColor: colors.primary, padding: spacing.md + 2, borderRadius: 12, alignItems: 'center', marginTop: spacing.xl },
  buttonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  backButton: { alignItems: 'center', marginTop: spacing.lg },
  backText: { color: colors.primary, fontSize: typography.md, fontWeight: '600' },
});

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import api from '../config/api';
import { useSafeScreen } from '../hooks/useSafeScreen';
import { colors, spacing, typography } from '../theme';

// Construit l'URL de notation selon le type de service.
function rateUrl(serviceType: string, serviceId: string): string {
  switch (serviceType) {
    case 'DELIVERY':
      return `/deliveries/${serviceId}/rate`;
    case 'CARPOOL':
      return `/carpools/bookings/${serviceId}/rate`;
    case 'RENTAL':
      return `/rentals/bookings/${serviceId}/rate`;
    case 'RIDE':
    default:
      return `/rides/${serviceId}/rate`;
  }
}

export default function RatingScreen({ navigation, route }: { navigation: any; route: any }) {
  // Rétrocompat : si on reçoit encore rideId/driverName, on les mappe sur le format générique.
  const params = route.params || {};
  const serviceType: string = params.serviceType || 'RIDE';
  const serviceId: string = params.serviceId || params.rideId;
  // Nom de la personne à évaluer (chauffeur, passager, livreur, propriétaire...)
  const ratedName: string | undefined = params.ratedName || params.driverName;
  // Libellé de l'action (ex: "course", "livraison", "trajet", "location")
  const serviceLabel: string = params.serviceLabel || 'prestation';

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const safe = useSafeScreen();

  const handleSubmit = async () => {
    if (!serviceId) {
      Alert.alert('Erreur', 'Prestation introuvable');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post(rateUrl(serviceType, serviceId), {
        score: rating,
        comment: comment || undefined,
      });
      Alert.alert('Merci ! 🙏', 'Votre évaluation a été enregistrée.', [
        { text: 'OK', onPress: () => navigation.navigate('Main') },
      ]);
    } catch (error: any) {
      Alert.alert('Erreur', error?.response?.data?.message || 'Impossible d\'enregistrer l\'évaluation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stars = [1, 2, 3, 4, 5];

  return (
    <View style={[styles.container, safe.topBottom]}>
      <Text style={styles.title}>Comment s'est passée votre {serviceLabel} ?</Text>
      {ratedName && <Text style={styles.driverName}>Avec {ratedName}</Text>}

      {/* Stars */}
      <View style={styles.starsRow}>
        {stars.map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => setRating(star)}
            accessibilityLabel={`${star} étoile${star > 1 ? 's' : ''}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: rating >= star }}
          >
            <Text style={[styles.star, rating >= star && styles.starActive]}>
              {rating >= star ? '⭐' : '☆'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.ratingLabel}>
        {rating === 5 && '🎉 Excellent !'}
        {rating === 4 && '👍 Très bien'}
        {rating === 3 && '😐 Correct'}
        {rating === 2 && '😕 Pas terrible'}
        {rating === 1 && '😞 Mauvais'}
      </Text>

      <TextInput
        style={styles.commentInput}
        placeholder="Un commentaire ? (optionnel)"
        value={comment}
        onChangeText={setComment}
        multiline
        numberOfLines={3}
        placeholderTextColor={colors.textLight}
        accessibilityLabel="Commentaire optionnel"
      />

      <TouchableOpacity
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={isSubmitting}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Envoyer l'évaluation</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.skipButton}
        onPress={() => navigation.navigate('Main')}
        accessibilityRole="button"
      >
        <Text style={styles.skipText}>Passer</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg, alignItems: 'center' },
  title: { fontSize: typography.xl, fontWeight: '700', color: colors.text, textAlign: 'center' },
  driverName: { fontSize: typography.md, color: colors.textSecondary, marginTop: spacing.xs },
  starsRow: { flexDirection: 'row', marginTop: spacing.xl, marginBottom: spacing.md },
  star: { fontSize: 40, marginHorizontal: 6, opacity: 0.3 },
  starActive: { opacity: 1 },
  ratingLabel: { fontSize: typography.md, color: colors.textSecondary, marginBottom: spacing.lg },
  commentInput: {
    width: '100%', backgroundColor: '#fff', padding: spacing.md, borderRadius: 12,
    fontSize: typography.md, borderWidth: 1, borderColor: colors.border,
    textAlignVertical: 'top', minHeight: 100,
  },
  button: { width: '100%', backgroundColor: colors.primary, padding: spacing.md, borderRadius: 12, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: typography.md, fontWeight: '700' },
  skipButton: { marginTop: spacing.md, padding: spacing.md },
  skipText: { color: colors.textSecondary, fontSize: typography.sm },
});

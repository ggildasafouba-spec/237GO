import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme';

interface MapProps {
  pickup?: { lat: number; lng: number; label?: string };
  dropoff?: { lat: number; lng: number; label?: string };
  driverLocation?: { lat: number; lng: number };
  showUserLocation?: boolean;
  onLocationSelect?: (location: { lat: number; lng: number; address: string }) => void;
  style?: object;
}

/**
 * Version web du composant carte.
 * react-native-maps n'est pas compatible navigateur : on affiche un
 * aperçu simplifié avec les coordonnées. La vraie carte s'affiche sur mobile.
 */
export default function MapComponent({ pickup, dropoff, driverLocation, style }: MapProps) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.icon}>🗺️</Text>
      <Text style={styles.title}>Carte (version mobile)</Text>
      {pickup && (
        <Text style={styles.coord}>🟢 Départ : {pickup.label || `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}`}</Text>
      )}
      {dropoff && (
        <Text style={styles.coord}>🔴 Arrivée : {dropoff.label || `${dropoff.lat.toFixed(4)}, ${dropoff.lng.toFixed(4)}`}</Text>
      )}
      {driverLocation && (
        <Text style={styles.coord}>🚗 Chauffeur : {driverLocation.lat.toFixed(4)}, {driverLocation.lng.toFixed(4)}</Text>
      )}
      <Text style={styles.hint}>La carte interactive est disponible sur l'application mobile.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 250,
    borderRadius: 12,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  icon: { fontSize: 40, marginBottom: spacing.sm },
  title: { fontSize: typography.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  coord: { fontSize: typography.sm, color: colors.textSecondary, marginBottom: 4 },
  hint: { fontSize: typography.xs, color: colors.textLight, marginTop: spacing.sm, textAlign: 'center' },
});

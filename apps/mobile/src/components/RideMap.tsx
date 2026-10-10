import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { colors, spacing, typography } from '../theme';

export interface LatLng {
  lat: number;
  lng: number;
}

interface RideMapProps {
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  driver?: LatLng | null;
  height?: number;
}

/**
 * Carte de la course.
 * react-native-maps est un module natif indisponible sur le web et nécessite
 * une clé Google Maps sur Android. On l'importe donc de façon défensive :
 * si l'import échoue (web, maps non configuré), on affiche un fallback
 * schématique au lieu de crasher.
 */
let MapView: any = null;
let Marker: any = null;
let mapsAvailable = false;

if (Platform.OS !== 'web') {
  try {
    // require dynamique pour éviter de casser le bundle web
    const maps = require('react-native-maps');
    MapView = maps.default;
    Marker = maps.Marker;
    mapsAvailable = !!MapView;
  } catch {
    mapsAvailable = false;
  }
}

export default function RideMap({ pickup, dropoff, driver, height = 240 }: RideMapProps) {
  // Point central : priorité au chauffeur, puis au pickup
  const center = driver || pickup || dropoff || { lat: 4.0511, lng: 9.7679 };

  if (!mapsAvailable || !MapView) {
    // Fallback : représentation schématique quand la carte native est indisponible
    return (
      <View style={[styles.fallback, { height }]}>
        <Text style={styles.fallbackIcon}>🗺️</Text>
        <Text style={styles.fallbackText}>Carte en direct</Text>
        {pickup && <Text style={styles.fallbackLine}>🟢 Départ : {pickup.lat.toFixed(4)}, {pickup.lng.toFixed(4)}</Text>}
        {driver && <Text style={styles.fallbackLine}>🚗 Chauffeur : {driver.lat.toFixed(4)}, {driver.lng.toFixed(4)}</Text>}
        {dropoff && <Text style={styles.fallbackLine}>🔴 Arrivée : {dropoff.lat.toFixed(4)}, {dropoff.lng.toFixed(4)}</Text>}
      </View>
    );
  }

  return (
    <View style={[styles.mapWrap, { height }]}>
      <MapView
        style={{ flex: 1 }}
        region={{
          latitude: center.lat,
          longitude: center.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        showsUserLocation
      >
        {pickup && (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            title="Départ"
            pinColor="green"
          />
        )}
        {dropoff && (
          <Marker
            coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
            title="Arrivée"
            pinColor="red"
          />
        )}
        {driver && (
          <Marker
            coordinate={{ latitude: driver.lat, longitude: driver.lng }}
            title="Chauffeur"
            description="Position en temps réel"
          >
            <Text style={{ fontSize: 30 }}>🚗</Text>
          </Marker>
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { borderRadius: 16, overflow: 'hidden', marginBottom: spacing.md },
  fallback: {
    borderRadius: 16, backgroundColor: colors.darkElevated,
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md, padding: spacing.lg,
  },
  fallbackIcon: { fontSize: 40, marginBottom: spacing.sm },
  fallbackText: { color: '#fff', fontSize: typography.md, fontWeight: '700', marginBottom: spacing.sm },
  fallbackLine: { color: colors.textLight, fontSize: typography.sm, marginTop: 2 },
});

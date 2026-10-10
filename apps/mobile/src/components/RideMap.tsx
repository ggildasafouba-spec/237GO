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
let UrlTile: any = null;
let PROVIDER_DEFAULT: any = undefined;
let mapsAvailable = false;

if (Platform.OS !== 'web') {
  try {
    // require dynamique pour éviter de casser le bundle web
    const maps = require('react-native-maps');
    MapView = maps.default;
    Marker = maps.Marker;
    UrlTile = maps.UrlTile;
    PROVIDER_DEFAULT = maps.PROVIDER_DEFAULT;
    mapsAvailable = !!MapView;
  } catch {
    mapsAvailable = false;
  }
}

/**
 * ErrorBoundary local : si la MapView native crashe au rendu
 * (ex: clé Google Maps absente du manifest Android), on affiche le
 * fallback au lieu de laisser l'écran entier se fermer.
 */
class MapErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// La MapView native Android (react-native-maps) exige une clé Google Maps dans
// le manifest pour s'initialiser, SINON elle crashe au rendu. Tant que la clé
// n'est pas configurée, on désactive la carte native et on affiche le fallback.
// Passer à true une fois la clé Google Maps ajoutée dans app.json.
const MAPS_ENABLED = false;

export default function RideMap({ pickup, dropoff, driver, height = 240 }: RideMapProps) {
  // Point central : priorité au chauffeur, puis au pickup
  const center = driver || pickup || dropoff || { lat: 4.0511, lng: 9.7679 };

  const fallback = (
    <View style={[styles.fallback, { height }]}>
      <Text style={styles.fallbackIcon}>🗺️</Text>
      <Text style={styles.fallbackText}>Carte en direct</Text>
      {pickup && <Text style={styles.fallbackLine}>🟢 Départ : {pickup.lat.toFixed(4)}, {pickup.lng.toFixed(4)}</Text>}
      {driver && <Text style={styles.fallbackLine}>🚗 Chauffeur : {driver.lat.toFixed(4)}, {driver.lng.toFixed(4)}</Text>}
      {dropoff && <Text style={styles.fallbackLine}>🔴 Arrivée : {dropoff.lat.toFixed(4)}, {dropoff.lng.toFixed(4)}</Text>}
    </View>
  );

  if (!MAPS_ENABLED || !mapsAvailable || !MapView) {
    return fallback;
  }

  return (
    <MapErrorBoundary fallback={fallback}>
    <View style={[styles.mapWrap, { height }]}>
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        region={{
          latitude: center.lat,
          longitude: center.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        showsUserLocation
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
      >
        {/* Fond de carte OpenStreetMap (gratuit, sans clé Google) */}
        {UrlTile && (
          <UrlTile
            urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maximumZ={19}
            flipY={false}
          />
        )}
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
    </MapErrorBoundary>
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

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { colors, spacing, typography } from '../theme';

interface MapProps {
  pickup?: { lat: number; lng: number; label?: string };
  dropoff?: { lat: number; lng: number; label?: string };
  driverLocation?: { lat: number; lng: number };
  showUserLocation?: boolean;
  onLocationSelect?: (location: { lat: number; lng: number; address: string }) => void;
  style?: object;
}

export default function MapComponent({
  pickup,
  dropoff,
  driverLocation,
  showUserLocation = true,
  onLocationSelect,
  style,
}: MapProps) {
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    requestLocation();
  }, []);

  useEffect(() => {
    if (mapRef.current && (pickup || dropoff || driverLocation)) {
      fitToMarkers();
    }
  }, [pickup, dropoff, driverLocation]);

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission de localisation refusée. Activez-la dans les paramètres.');
        setIsLoading(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      setIsLoading(false);
    } catch {
      setErrorMsg('Impossible d\'obtenir votre position');
      // Fallback: Douala centre
      setUserLocation({ latitude: 4.0511, longitude: 9.7679 });
      setIsLoading(false);
    }
  };

  const fitToMarkers = () => {
    const coordinates: { latitude: number; longitude: number }[] = [];

    if (pickup) coordinates.push({ latitude: pickup.lat, longitude: pickup.lng });
    if (dropoff) coordinates.push({ latitude: dropoff.lat, longitude: dropoff.lng });
    if (driverLocation) coordinates.push({ latitude: driverLocation.lat, longitude: driverLocation.lng });
    if (userLocation) coordinates.push(userLocation);

    if (coordinates.length >= 2 && mapRef.current) {
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
        animated: true,
      });
    }
  };

  const handleMapPress = async (event: any) => {
    if (!onLocationSelect) return;

    const { latitude, longitude } = event.nativeEvent.coordinate;

    // Reverse geocoding
    try {
      const [result] = await Location.reverseGeocodeAsync({ latitude, longitude });
      const address = result
        ? `${result.street || ''} ${result.city || ''} ${result.region || ''}`.trim()
        : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

      onLocationSelect({ lat: latitude, lng: longitude, address });
    } catch {
      onLocationSelect({
        lat: latitude,
        lng: longitude,
        address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      });
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, style]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Chargement de la carte...</Text>
      </View>
    );
  }

  if (errorMsg && !userLocation) {
    return (
      <View style={[styles.errorContainer, style]}>
        <Text style={styles.errorIcon}>📍</Text>
        <Text style={styles.errorText}>{errorMsg}</Text>
      </View>
    );
  }

  const initialRegion = userLocation
    ? {
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }
    : {
        latitude: 4.0511,
        longitude: 9.7679,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };

  return (
    <View style={[styles.mapContainer, style]}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={showUserLocation}
        showsMyLocationButton
        onPress={handleMapPress}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        accessibilityLabel="Carte de navigation"
      >
        {/* Marqueur de départ */}
        {pickup && (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            title="Départ"
            description={pickup.label}
            pinColor="green"
          />
        )}

        {/* Marqueur d'arrivée */}
        {dropoff && (
          <Marker
            coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
            title="Destination"
            description={dropoff.label}
            pinColor="red"
          />
        )}

        {/* Position du chauffeur */}
        {driverLocation && (
          <Marker
            coordinate={{ latitude: driverLocation.lat, longitude: driverLocation.lng }}
            title="Chauffeur"
          >
            <View style={styles.driverMarker}>
              <Text style={styles.driverMarkerText}>🚗</Text>
            </View>
          </Marker>
        )}

        {/* Ligne entre départ et arrivée */}
        {pickup && dropoff && (
          <Polyline
            coordinates={[
              { latitude: pickup.lat, longitude: pickup.lng },
              { latitude: dropoff.lat, longitude: dropoff.lng },
            ]}
            strokeColor={colors.primary}
            strokeWidth={3}
            lineDashPattern={[10, 5]}
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    height: 250,
  },
  map: {
    flex: 1,
  },
  loadingContainer: {
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.sm,
  },
  errorContainer: {
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: spacing.lg,
  },
  errorIcon: {
    fontSize: 36,
    marginBottom: spacing.sm,
  },
  errorText: {
    color: colors.warning,
    fontSize: typography.sm,
    textAlign: 'center',
  },
  driverMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  driverMarkerText: {
    fontSize: 20,
  },
});

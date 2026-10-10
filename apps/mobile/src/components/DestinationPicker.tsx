import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Platform,
  Modal,
} from 'react-native';
import { colors, spacing, typography } from '../theme';

export interface PickedPlace {
  lat: number;
  lng: number;
  label: string;
}

interface DestinationPickerProps {
  visible: boolean;
  initialCenter: { lat: number; lng: number };
  title?: string;
  onConfirm: (place: PickedPlace) => void;
  onClose: () => void;
}

// react-native-maps en défensif (indispo sur web)
let MapView: any = null;
let UrlTile: any = null;
let PROVIDER_DEFAULT: any = undefined;
let mapsAvailable = false;

// Voir RideMap : la carte native Android exige une clé Google Maps. Tant qu'elle
// n'est pas configurée, on reste en mode recherche de lieu (sans carte native)
// pour éviter tout crash.
const MAPS_ENABLED = false;

if (Platform.OS !== 'web') {
  try {
    const maps = require('react-native-maps');
    MapView = maps.default;
    UrlTile = maps.UrlTile;
    PROVIDER_DEFAULT = maps.PROVIDER_DEFAULT;
    mapsAvailable = !!MapView;
  } catch {
    mapsAvailable = false;
  }
}

interface SearchResult {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Sélecteur de destination adapté au Cameroun :
 * - l'utilisateur déplace la carte, l'épingle reste fixe au centre (technique Yango/Uber)
 * - recherche de lieux/repères via Nominatim (OpenStreetMap), gratuit et sans clé
 * Pas de dépendance à un adressage postal (peu fiable au Cameroun).
 */
export default function DestinationPicker({
  visible,
  initialCenter,
  title = 'Choisir la destination',
  onConfirm,
  onClose,
}: DestinationPickerProps) {
  const [center, setCenter] = useState(initialCenter);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const mapRef = useRef<any>(null);

  const search = async () => {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      // Nominatim OSM, biaisé vers le Cameroun (countrycodes=cm)
      const url =
        `https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=cm&q=` +
        encodeURIComponent(query);
      const res = await fetch(url, {
        headers: { 'User-Agent': '237GO/1.0 (mobility app Cameroon)' },
      });
      const data = await res.json();
      const mapped: SearchResult[] = (data || []).map((d: any) => ({
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        label: d.display_name as string,
      }));
      setResults(mapped);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (r: SearchResult) => {
    setCenter({ lat: r.lat, lng: r.lng });
    setResults([]);
    setQuery(r.label.split(',')[0]);
    mapRef.current?.animateToRegion?.({
      latitude: r.lat,
      longitude: r.lng,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
  };

  const [confirming, setConfirming] = useState(false);

  // Reverse geocode OSM : transformer un point en libellé lisible (quartier/ville)
  const reverseLabel = async (lat: number, lng: number): Promise<string> => {
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&lat=${lat}&lon=${lng}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': '237GO/1.0 (mobility app Cameroon)' },
      });
      const data = await res.json();
      const a = data?.address || {};
      // Construire un libellé compact : repère/quartier + ville
      const parts = [
        a.road || a.neighbourhood || a.suburb || a.hamlet,
        a.city || a.town || a.village || a.county,
      ].filter(Boolean);
      return parts.join(', ') || data?.display_name?.split(',').slice(0, 2).join(',') || '';
    } catch {
      return '';
    }
  };

  const confirm = async () => {
    // Si l'utilisateur a tapé une recherche, on garde son libellé.
    // Sinon (épingle seule), on tente un reverse-geocode pour un texte lisible.
    let label = query.trim();
    if (!label) {
      setConfirming(true);
      label = await reverseLabel(center.lat, center.lng);
      setConfirming(false);
    }
    onConfirm({
      lat: center.lat,
      lng: center.lng,
      label: label || `${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} accessibilityLabel="Fermer">
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Recherche de repère / lieu */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un lieu, un repère (ex: Carrefour Ndokotti)"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={search}
            returnKeyType="search"
            placeholderTextColor={colors.textLight}
            accessibilityLabel="Rechercher un lieu"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={search} accessibilityLabel="Lancer la recherche">
            {searching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.searchBtnText}>🔍</Text>}
          </TouchableOpacity>
        </View>

        {results.length > 0 && (
          <FlatList
            style={styles.resultsList}
            data={results}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.resultItem} onPress={() => pickResult(item)}>
                <Text style={styles.resultIcon}>📍</Text>
                <Text style={styles.resultLabel} numberOfLines={2}>{item.label}</Text>
              </TouchableOpacity>
            )}
          />
        )}

        {/* Carte avec épingle fixe au centre */}
        <View style={styles.mapArea}>
          {MAPS_ENABLED && mapsAvailable && MapView ? (
            <>
              <MapView
                ref={mapRef}
                style={{ flex: 1 }}
                provider={PROVIDER_DEFAULT}
                mapType={Platform.OS === 'android' ? 'none' : 'standard'}
                initialRegion={{
                  latitude: center.lat,
                  longitude: center.lng,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }}
                onRegionChangeComplete={(r: any) =>
                  setCenter({ lat: r.latitude, lng: r.longitude })
                }
                showsUserLocation
              >
                {UrlTile && (
                  <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
                )}
              </MapView>
              {/* Épingle fixe au centre */}
              <View pointerEvents="none" style={styles.centerPin}>
                <Text style={styles.centerPinIcon}>📍</Text>
              </View>
            </>
          ) : (
            <View style={styles.mapFallback}>
              <Text style={styles.fallbackText}>
                Carte indisponible ici. Recherchez un lieu ci-dessus pour fixer la destination.
              </Text>
              <Text style={styles.fallbackCoord}>
                Position : {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
              </Text>
            </View>
          )}
        </View>

        {/* Confirmation */}
        <View style={styles.footer}>
          <Text style={styles.footerHint}>Déplacez la carte pour positionner l'épingle sur la destination</Text>
          <TouchableOpacity style={styles.confirmBtn} onPress={confirm} disabled={confirming} accessibilityRole="button">
            {confirming ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.confirmText}>Confirmer la destination</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.md, paddingTop: spacing.xl + 10, backgroundColor: colors.dark,
  },
  close: { color: '#fff', fontSize: 22, fontWeight: '700' },
  title: { color: '#fff', fontSize: typography.md, fontWeight: '800' },
  searchRow: { flexDirection: 'row', padding: spacing.md, backgroundColor: colors.dark },
  searchInput: {
    flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm, fontSize: typography.sm,
  },
  searchBtn: {
    marginLeft: spacing.sm, backgroundColor: colors.primary, borderRadius: 10,
    paddingHorizontal: spacing.md, justifyContent: 'center', alignItems: 'center',
  },
  searchBtnText: { fontSize: 18 },
  resultsList: { maxHeight: 220, backgroundColor: '#fff' },
  resultItem: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  resultIcon: { fontSize: 18, marginRight: spacing.sm },
  resultLabel: { flex: 1, fontSize: typography.sm, color: colors.text },
  mapArea: { flex: 1 },
  centerPin: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  centerPinIcon: { fontSize: 40, marginBottom: 30 },
  mapFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  fallbackText: { color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
  fallbackCoord: { color: colors.primary, fontWeight: '700' },
  footer: { padding: spacing.md, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border },
  footerHint: { fontSize: typography.xs, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
  confirmBtn: { backgroundColor: colors.primary, padding: spacing.md, borderRadius: 12, alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: '800', fontSize: typography.md },
});

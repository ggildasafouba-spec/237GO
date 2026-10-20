import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ViewStyle,
  StyleProp,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

interface ScreenContainerProps {
  children: React.ReactNode;
  /**
   * Si true (défaut), le contenu défile verticalement : rien n'est jamais coupé,
   * quel que soit la taille de l'écran. Mettre à false pour un écran plein
   * (ex: carte temps réel, listes avec leur propre FlatList).
   */
  scroll?: boolean;
  /** Couleur de fond de l'écran. */
  backgroundColor?: string;
  /** Applique une marge de sécurité en haut (encoche / barre de statut). Défaut: true. */
  edgeTop?: boolean;
  /** Applique une marge de sécurité en bas (barre gestuelle Android / iPhone). Défaut: true. */
  edgeBottom?: boolean;
  /** Padding horizontal interne. Défaut: spacing.lg. */
  padded?: boolean;
  /** Styles additionnels pour le conteneur de contenu. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Pull-to-refresh (optionnel). */
  refreshing?: boolean;
  onRefresh?: () => void;
}

/**
 * Conteneur d'écran responsive.
 *
 * - Respecte automatiquement les zones sûres (encoche, Dynamic Island, barre de
 *   statut, barre de navigation gestuelle) sur TOUS les téléphones.
 * - Fait défiler le contenu par défaut : aucune information n'est coupée même sur
 *   les petits écrans.
 * - Décale le contenu au-dessus du clavier pour que les champs restent visibles.
 *
 * Remplace les anciens `paddingTop: spacing.xl + 20` codés en dur.
 */
export default function ScreenContainer({
  children,
  scroll = true,
  backgroundColor = colors.background,
  edgeTop = true,
  edgeBottom = true,
  padded = true,
  contentStyle,
  refreshing,
  onRefresh,
}: ScreenContainerProps) {
  const insets = useSafeAreaInsets();

  // Marges de sécurité adaptatives + un petit confort visuel.
  const paddingTop = edgeTop ? insets.top + spacing.md : 0;
  const paddingBottom = edgeBottom ? insets.bottom + spacing.lg : 0;
  const paddingHorizontal = padded ? spacing.lg : 0;

  const innerPadding: ViewStyle = {
    paddingTop,
    paddingBottom,
    paddingHorizontal,
  };

  const body = scroll ? (
    <ScrollView
      style={[styles.flex, { backgroundColor }]}
      contentContainerStyle={[styles.scrollContent, innerPadding, contentStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, { backgroundColor }, innerPadding, contentStyle]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
});

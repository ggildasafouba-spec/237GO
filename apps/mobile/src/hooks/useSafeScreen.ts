import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ViewStyle } from 'react-native';
import { spacing } from '../theme';

/**
 * Renvoie des styles de marge de sécurité adaptatifs selon le téléphone
 * (encoche, Dynamic Island, barre de statut, barre de navigation gestuelle).
 *
 * Remplace les `paddingTop: spacing.xl + 20` codés en dur qui coupaient le
 * contenu sur certains écrans.
 *
 * Usage :
 *   const safe = useSafeScreen();
 *   <View style={[styles.container, safe.topBottom]}>   // écran plein
 *   <ScrollView contentContainerStyle={[styles.content, safe.scroll]}> // écran défilant
 */
export function useSafeScreen() {
  const insets = useSafeAreaInsets();

  const top: ViewStyle = { paddingTop: insets.top + spacing.md };
  const bottom: ViewStyle = { paddingBottom: insets.bottom + spacing.md };
  const topBottom: ViewStyle = {
    paddingTop: insets.top + spacing.md,
    paddingBottom: insets.bottom + spacing.md,
  };
  // Pour les ScrollView : marge basse plus large afin que le dernier bouton
  // ne passe jamais sous la barre système.
  const scroll: ViewStyle = {
    paddingTop: insets.top + spacing.md,
    paddingBottom: insets.bottom + spacing.xl,
  };

  return { insets, top, bottom, topBottom, scroll };
}

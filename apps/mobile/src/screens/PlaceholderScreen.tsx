import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography } from '../theme';

export default function PlaceholderScreen({ navigation, route }: { navigation: any; route: any }) {
  const screenName = route?.name || 'Page';

  const descriptions: Record<string, { icon: string; title: string; desc: string }> = {
    Delivery: {
      icon: '📦',
      title: 'GO Deliver',
      desc: 'Livraison de colis, documents, repas et courses au marché.',
    },
    Market: {
      icon: '🛒',
      title: 'GO Market',
      desc: 'Commandez directement depuis les marchés et commerces locaux.',
    },
    Carpool: {
      icon: '🚌',
      title: 'GO Share',
      desc: 'Covoiturage inter-villes : Douala ↔ Yaoundé, Bafoussam, etc.',
    },
    Rental: {
      icon: '🔑',
      title: 'GO Rent',
      desc: 'Location de véhicules avec ou sans chauffeur.',
    },
    Business: {
      icon: '💼',
      title: 'GO Business',
      desc: 'Gestion des déplacements entreprise avec facturation centralisée.',
    },
    Profile: {
      icon: '👤',
      title: 'Mon profil',
      desc: 'Gérez vos informations, contacts d\'urgence et préférences.',
    },
    More: {
      icon: '⚙️',
      title: 'Plus',
      desc: 'Paramètres, aide, à propos de 237GO.',
    },
  };

  const info = descriptions[screenName] || { icon: '🚧', title: screenName, desc: 'Bientôt disponible' };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{info.icon}</Text>
      <Text style={styles.title}>{info.title}</Text>
      <Text style={styles.description}>{info.desc}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Bientôt disponible</Text>
      </View>
      {navigation.canGoBack() && (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Retour"
          accessibilityRole="button"
        >
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  icon: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: typography.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  badge: {
    marginTop: spacing.lg,
    backgroundColor: '#FFF8E1',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
  },
  badgeText: {
    color: '#F57C00',
    fontWeight: '600',
    fontSize: typography.sm,
  },
  backButton: {
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  backText: {
    color: colors.primary,
    fontSize: typography.md,
    fontWeight: '600',
  },
});

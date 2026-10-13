import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useChatStore } from '../store/chatStore';
import { colors, spacing, typography } from '../theme';

const SERVICE_LABELS: Record<string, string> = {
  RIDE: '🚗 Course',
  DELIVERY: '📦 Livraison',
  CARPOOL: '🚐 Covoiturage',
  RENTAL: '🔑 Location',
  MARKET: '🛒 Commande',
  DIRECT: '💬 Discussion',
};

export default function MessagesScreen({ navigation }: { navigation: any }) {
  const { conversations, isLoading, fetchConversations } = useChatStore();

  useEffect(() => {
    fetchConversations();
    const unsubscribe = navigation.addListener('focus', fetchConversations);
    return unsubscribe;
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Messages</Text>
      </View>

      {isLoading && conversations.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c, i) => `${c.serviceType}:${c.serviceId}:${c.interlocutor.id}:${i}`}
          onRefresh={fetchConversations}
          refreshing={isLoading}
          contentContainerStyle={{ padding: spacing.md }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyText}>Aucune conversation pour le moment</Text>
              <Text style={styles.emptyHint}>Les discussions avec vos chauffeurs, marchands ou propriétaires apparaîtront ici.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.convCard}
              onPress={() => navigation.navigate('Chat', {
                serviceType: item.serviceType,
                serviceId: item.serviceId,
                interlocutor: item.interlocutor,
              })}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {item.interlocutor.firstName?.[0]}{item.interlocutor.lastName?.[0]}
                </Text>
              </View>
              <View style={styles.convInfo}>
                <Text style={styles.convName}>{item.interlocutor.firstName} {item.interlocutor.lastName}</Text>
                <Text style={styles.convService}>{SERVICE_LABELS[item.serviceType] || item.serviceType}</Text>
                <Text style={styles.convLast} numberOfLines={1}>
                  {item.lastMessage.imageUrl ? '📷 Photo' : item.lastMessage.content}
                </Text>
              </View>
              {item.unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, paddingTop: spacing.xl + 20, backgroundColor: '#fff' },
  back: { color: colors.primary, fontSize: typography.md, fontWeight: '600', marginBottom: spacing.sm },
  title: { fontSize: typography.xl, fontWeight: '800', color: colors.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { fontSize: typography.md, color: colors.textSecondary, fontWeight: '600' },
  emptyHint: { fontSize: typography.sm, color: colors.textLight, textAlign: 'center', marginTop: spacing.sm },
  convCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: typography.md },
  convInfo: { flex: 1 },
  convName: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  convService: { fontSize: typography.xs, color: colors.primary, marginTop: 1 },
  convLast: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 2 },
  badge: { backgroundColor: colors.accent, borderRadius: 12, minWidth: 24, height: 24, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: typography.xs, fontWeight: '800' },
});

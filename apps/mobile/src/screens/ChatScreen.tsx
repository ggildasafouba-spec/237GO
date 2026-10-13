import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { pickAndUploadImage } from '../config/upload';
import { colors, spacing, typography } from '../theme';

export default function ChatScreen({ navigation, route }: { navigation: any; route: any }) {
  // Params attendus : serviceType, serviceId, interlocutor { id, firstName, lastName }
  const { serviceType, serviceId, interlocutor } = route.params || {};
  const { user } = useAuthStore();
  const { messages, isLoading, fetchMessages, sendMessage, listenForMessages, clearMessages } = useChatStore();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (serviceType && serviceId && interlocutor?.id) {
      fetchMessages(serviceType, serviceId, interlocutor.id);
      listenForMessages();
    }
    return () => clearMessages();
  }, [serviceType, serviceId, interlocutor?.id]);

  useEffect(() => {
    if (messages.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
  }, [messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');
    try {
      await sendMessage({ serviceType, serviceId, receiverId: interlocutor.id, content: text });
    } catch {
      Alert.alert('Erreur', 'Message non envoyé. Réessayez.');
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleSendPhoto = async () => {
    setUploading(true);
    try {
      const url = await pickAndUploadImage();
      if (url) {
        await sendMessage({ serviceType, serviceId, receiverId: interlocutor.id, imageUrl: url });
      }
    } catch {
      Alert.alert('Erreur', 'Photo non envoyée.');
    } finally {
      setUploading(false);
    }
  };

  const interlocutorName = interlocutor ? `${interlocutor.firstName} ${interlocutor.lastName}` : 'Discussion';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{interlocutorName}</Text>
          <Text style={styles.headerSub}>💬 Messagerie 237GO</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {isLoading && messages.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyText}>Démarrez la conversation</Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.senderId === user?.id;
            return (
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.msgImage} />
                ) : null}
                {item.content ? (
                  <Text style={[styles.msgText, mine && styles.msgTextMine]}>{item.content}</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}

      <View style={[styles.inputBar, { paddingBottom: spacing.sm + insets.bottom }]}>
        <TouchableOpacity style={styles.photoBtn} onPress={handleSendPhoto} disabled={uploading}>
          {uploading ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.photoIcon}>📷</Text>}
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Écrivez un message..."
          value={input}
          onChangeText={setInput}
          placeholderTextColor={colors.textLight}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendIcon}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xxl },
  emptyIcon: { fontSize: 44, marginBottom: spacing.sm },
  emptyText: { color: colors.textSecondary, fontSize: typography.md },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.primary,
  },
  back: { color: '#fff', fontSize: 26, fontWeight: '700' },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: typography.lg, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: typography.xs },
  bubble: { maxWidth: '80%', padding: spacing.sm, borderRadius: 14, marginBottom: spacing.sm },
  bubbleMine: { backgroundColor: colors.primary, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  msgText: { fontSize: typography.md, color: colors.text, lineHeight: 20 },
  msgTextMine: { color: '#fff' },
  msgImage: { width: 200, height: 150, borderRadius: 10, marginBottom: 4 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border,
  },
  photoBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  photoIcon: { fontSize: 22 },
  input: {
    flex: 1, backgroundColor: colors.background, borderRadius: 20,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: typography.md,
    maxHeight: 100, marginHorizontal: spacing.xs,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
  sendIcon: { color: '#fff', fontSize: 20 },
});

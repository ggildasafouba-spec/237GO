import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import api from '../config/api';
import { colors, spacing, typography } from '../theme';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Comment devenir chauffeur ?',
  'A wan go Akwa, how e dey work?',
  'Comment marche le paiement protégé ?',
  'C\'est quoi les points de fidélité ?',
];

export default function AssistantScreen({ navigation }: { navigation: any }) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'Bonjour 👋 Je suis Go-Assistant. Comment puis-je vous aider ? (Français, English, Pidgin)' },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Msg = { role: 'user', content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      // On envoie l'historique (sans le message de bienvenue initial)
      const history = newMessages.slice(1).map((m) => ({ role: m.role, content: m.content }));
      const res = await api.post('/ai/chat', { message: trimmed, history: history.slice(0, -1) });
      const reply = res.data.data.reply as string;
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (error: any) {
      const msg = error?.response?.data?.message || 'L\'assistant est indisponible pour le moment.';
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>🤖 Go-Assistant</Text>
          <Text style={styles.headerSub}>Français · English · Pidgin</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
      >
        {messages.map((m, i) => (
          <View
            key={i}
            style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
          >
            <Text style={[styles.bubbleText, m.role === 'user' && styles.bubbleTextUser]}>{m.content}</Text>
          </View>
        ))}

        {isLoading && (
          <View style={[styles.bubble, styles.bubbleAssistant]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {/* Suggestions au démarrage */}
        {messages.length === 1 && (
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s) => (
              <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => send(s)}>
                <Text style={styles.suggestionText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Écrivez votre message..."
          value={input}
          onChangeText={setInput}
          placeholderTextColor={colors.textLight}
          multiline
          onSubmitEditing={() => send(input)}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || isLoading) && styles.sendBtnDisabled]}
          onPress={() => send(input)}
          disabled={!input.trim() || isLoading}
        >
          <Text style={styles.sendBtnText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: spacing.xl + 10, paddingBottom: spacing.md, paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
  },
  backText: { color: '#fff', fontSize: 26, fontWeight: '700' },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: typography.lg, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: typography.xs },
  messages: { flex: 1 },
  bubble: { maxWidth: '82%', padding: spacing.md, borderRadius: 16, marginBottom: spacing.sm },
  bubbleUser: { backgroundColor: colors.primary, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: colors.surface, alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: typography.md, color: colors.text, lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  suggestions: { marginTop: spacing.md, gap: spacing.sm },
  suggestionChip: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: colors.primary,
    borderRadius: 20, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignSelf: 'flex-start',
  },
  suggestionText: { color: colors.primary, fontSize: typography.sm },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, backgroundColor: colors.background, borderRadius: 20,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: typography.md,
    maxHeight: 100, marginRight: spacing.sm,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontSize: 20 },
});

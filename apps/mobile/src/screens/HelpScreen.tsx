import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { useSafeScreen } from '../hooks/useSafeScreen';
import { colors, spacing, typography } from '../theme';
import { LEGAL_URLS, SUPPORT, openUrl, openWhatsAppSupport, openEmailSupport } from '../config/legal';

interface Faq { q: string; a: string }
interface FaqGroup { title: string; icon: string; items: Faq[] }

// Réponses alignées sur le fonctionnement réel de l'app (à mettre à jour si une règle change)
const FAQ: FaqGroup[] = [
  {
    title: 'Courses', icon: '🚗',
    items: [
      { q: 'Comment commander une course ?', a: 'Accueil → GO Ride. Choisissez votre destination, le type de véhicule (moto, éco, confort, VIP) et le paiement, puis validez. Les chauffeurs proches reçoivent votre demande.' },
      { q: 'Puis-je proposer mon prix ?', a: 'Oui. Avant de valider, vous pouvez proposer un prix. Le chauffeur l\'accepte ou non.' },
      { q: 'Comment annuler une course ?', a: 'Sur l\'écran de la course, bouton « Annuler ». Tant qu\'aucun chauffeur n\'a accepté, l\'annulation est gratuite et vous êtes remboursé. Après acceptation, une indemnité peut revenir au chauffeur qui s\'est déplacé.' },
      { q: 'Comment partager mon trajet avec un proche ?', a: 'Dès que la course est commandée, bouton « Partager mon trajet ». Votre proche reçoit un lien (WhatsApp, SMS…) et suit le trajet en direct, sans application. Le lien dure 12 h.' },
    ],
  },
  {
    title: 'Livraisons et GO Market', icon: '📦',
    items: [
      { q: 'Combien coûte une livraison ?', a: '1 000 F jusqu\'à 3 km, puis 150 F par kilomètre en plus. Le prix exact s\'affiche avant de valider.' },
      { q: 'Pourquoi je ne peux pas commander dans un restaurant ?', a: 'Le restaurant est fermé à cette heure (ses horaires s\'affichent : « ouvre à 08:00 »). Vous pouvez consulter le menu et commander à l\'ouverture.' },
      { q: 'Quand le restaurant est-il payé ?', a: 'Quand vous confirmez avoir reçu votre commande. Jusque-là, votre argent est bloqué en sécurité par 237GO.' },
    ],
  },
  {
    title: 'Paiement et portefeuille', icon: '💰',
    items: [
      { q: 'Comment fonctionne le paiement sécurisé ?', a: 'Votre argent est bloqué par 237GO au moment de la commande, puis versé au prestataire seulement quand le service est terminé. En cas de problème, signalez-le avant de confirmer.' },
      { q: 'Comment recharger mon portefeuille ?', a: 'Portefeuille → Recharger, avec Orange Money ou MTN MoMo.' },
      { q: 'Comment retirer mon argent ?', a: 'Portefeuille → Retirer (minimum 500 F). Le versement vers votre numéro Orange Money ou MTN MoMo est effectué sous 24 h ouvrées.' },
      { q: 'Pourquoi mon retrait est-il bloqué ?', a: 'Après un changement ou une réinitialisation du mot de passe, les retraits sont bloqués 24 h pour votre sécurité. Si ce n\'était pas vous, contactez le support tout de suite.' },
    ],
  },
  {
    title: 'Compte et sécurité', icon: '🔐',
    items: [
      { q: 'J\'ai oublié mon mot de passe', a: 'Écran de connexion → « Mot de passe oublié ? ». Un code vous est envoyé par email. Sans email sur votre compte, contactez le support WhatsApp.' },
      { q: 'À quoi servent les contacts d\'urgence ?', a: 'Profil → Contacts d\'urgence. En cas de SOS, l\'app vous propose de les prévenir avec votre position.' },
      { q: 'Que fait le bouton SOS ?', a: 'Il alerte immédiatement l\'équipe 237GO avec votre position et votre course, et vous propose de prévenir un proche. En cas de danger, appelez aussi le 117.' },
      { q: '237GO peut-il me demander mon mot de passe ?', a: 'Jamais. Ne communiquez à personne votre mot de passe ni les codes reçus par email ou SMS, même à quelqu\'un qui dit être de 237GO.' },
      { q: 'Comment supprimer mon compte ?', a: 'Profil → « Supprimer mon compte ». Il faut d\'abord terminer vos courses et commandes en cours et retirer votre solde.' },
    ],
  },
  {
    title: 'Devenir partenaire', icon: '🤝',
    items: [
      { q: 'Comment devenir chauffeur ?', a: 'Profil → Devenir chauffeur. Il faut un permis de conduire, une CNI, les informations du véhicule et une adresse email. L\'équipe 237GO vérifie le dossier.' },
      { q: 'Comment vendre sur GO Market ?', a: 'Profil → Devenir marchand. Il faut une adresse email, une pièce d\'identité et les informations de la boutique. Le menu peut être importé depuis un fichier Excel.' },
      { q: 'Quelle commission prend 237GO ?', a: 'Sur les courses et les livraisons, 237GO garde 15 % du prix. Le reste est versé au chauffeur.' },
    ],
  },
];

export default function HelpScreen({ navigation }: { navigation: any }) {
  const safe = useSafeScreen();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ScrollView style={styles.container} contentContainerStyle={[safe.topBottom, { paddingBottom: spacing.xl * 2 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Retour" accessibilityRole="button">
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Aide et support</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Urgence */}
      <View style={styles.emergency}>
        <Text style={styles.emergencyTitle}>🚨 En danger ?</Text>
        <Text style={styles.emergencyText}>Appelez immédiatement les secours. Pendant une course, utilisez aussi le bouton SOS.</Text>
        <View style={styles.row}>
          {[
            { label: 'Police', num: '117' },
            { label: 'Pompiers', num: '118' },
            { label: 'SAMU', num: '119' },
          ].map((e) => (
            <TouchableOpacity
              key={e.num}
              style={styles.emergencyBtn}
              onPress={() => Linking.openURL(`tel:${e.num}`)}
              accessibilityRole="button"
              accessibilityLabel={`Appeler ${e.label} ${e.num}`}
            >
              <Text style={styles.emergencyBtnText}>{e.label}</Text>
              <Text style={styles.emergencyBtnNum}>📞 {e.num}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.emergencyNote}>Gendarmerie : 113</Text>
      </View>

      {/* Contacter 237GO */}
      <Text style={styles.section}>Contacter 237GO</Text>
      <TouchableOpacity style={styles.contact} onPress={() => openWhatsAppSupport()} accessibilityRole="button">
        <Text style={styles.contactIcon}>💬</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.contactTitle}>WhatsApp</Text>
          <Text style={styles.contactSub}>{SUPPORT.whatsappLabel}</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.contact} onPress={() => openEmailSupport()} accessibilityRole="button">
        <Text style={styles.contactIcon}>✉️</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.contactTitle}>Email</Text>
          <Text style={styles.contactSub}>{SUPPORT.email}</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.contact} onPress={() => navigation.navigate('Assistant')} accessibilityRole="button">
        <Text style={styles.contactIcon}>🤖</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.contactTitle}>Go-Assistant</Text>
          <Text style={styles.contactSub}>Réponse immédiate, en français, anglais ou pidgin</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </TouchableOpacity>
      <Text style={styles.tip}>Un problème sur une course ou une commande ? Signalez-le depuis l'écran du service (« Signaler un problème ») : votre paiement reste bloqué le temps de l'examen.</Text>

      {/* Questions fréquentes */}
      <Text style={styles.section}>Questions fréquentes</Text>
      {FAQ.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.icon} {group.title}</Text>
          {group.items.map((item) => {
            const key = `${group.title}:${item.q}`;
            const isOpen = open === key;
            return (
              <TouchableOpacity
                key={key}
                style={styles.faq}
                onPress={() => setOpen(isOpen ? null : key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
              >
                <View style={styles.faqHead}>
                  <Text style={styles.faqQ}>{item.q}</Text>
                  <Text style={styles.faqToggle}>{isOpen ? '−' : '+'}</Text>
                </View>
                {isOpen && <Text style={styles.faqA}>{item.a}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      {/* Informations légales */}
      <Text style={styles.section}>Informations légales</Text>
      {[
        { label: 'Conditions d\'utilisation', url: LEGAL_URLS.terms },
        { label: 'Politique de confidentialité', url: LEGAL_URLS.privacy },
        { label: 'Mentions légales', url: LEGAL_URLS.legal },
      ].map((l) => (
        <TouchableOpacity key={l.url} style={styles.legal} onPress={() => openUrl(l.url)} accessibilityRole="link">
          <Text style={styles.legalText}>{l.label}</Text>
          <Text style={styles.arrow}>↗</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  back: { fontSize: 26, fontWeight: '700', color: colors.text },
  title: { fontSize: typography.xl, fontWeight: '800', color: colors.text },
  emergency: { backgroundColor: '#FFEBEE', borderRadius: 14, padding: spacing.md, borderWidth: 1, borderColor: '#EF9A9A' },
  emergencyTitle: { fontSize: typography.lg, fontWeight: '800', color: colors.error },
  emergencyText: { fontSize: typography.sm, color: colors.text, marginTop: 4, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  emergencyBtn: { flex: 1, backgroundColor: colors.error, borderRadius: 10, padding: spacing.sm + 2, alignItems: 'center' },
  emergencyBtnText: { color: '#fff', fontWeight: '700', fontSize: typography.xs },
  emergencyBtnNum: { color: '#fff', fontWeight: '900', fontSize: typography.md, marginTop: 2 },
  emergencyNote: { fontSize: typography.xs, color: colors.text, marginTop: spacing.sm, fontWeight: '600' },
  section: { fontSize: typography.md, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  contact: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  contactIcon: { fontSize: 24, marginRight: spacing.md },
  contactTitle: { fontSize: typography.md, fontWeight: '700', color: colors.text },
  contactSub: { fontSize: typography.sm, color: colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: typography.lg, color: colors.textSecondary },
  tip: { fontSize: typography.xs, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 },
  group: { marginBottom: spacing.md },
  groupTitle: { fontSize: typography.sm, fontWeight: '800', color: colors.primary, marginBottom: spacing.xs },
  faq: { backgroundColor: '#fff', borderRadius: 10, padding: spacing.md, marginBottom: 6 },
  faqHead: { flexDirection: 'row', alignItems: 'center' },
  faqQ: { flex: 1, fontSize: typography.sm, fontWeight: '700', color: colors.text },
  faqToggle: { fontSize: typography.lg, fontWeight: '800', color: colors.primary, marginLeft: spacing.sm },
  faqA: { fontSize: typography.sm, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 20 },
  legal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: spacing.md, marginBottom: 6 },
  legalText: { fontSize: typography.sm, fontWeight: '600', color: colors.text },
});

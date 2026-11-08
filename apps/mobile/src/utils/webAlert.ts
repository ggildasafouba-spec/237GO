import { Alert, AlertButton, Platform } from 'react-native';

/**
 * ALERTES SUR LA VERSION WEB (app.237go.app)
 *
 * Dans react-native-web, Alert.alert est une fonction VIDE (`static alert() {}`) :
 * sur le web, aucun message de l'app ne s'affichait (erreurs, "Localisation requise"...)
 * et les boutons des confirmations n'étaient jamais proposés, donc leur action ne
 * se déclenchait jamais ("Confirmer la réservation", "Annuler la course ?"...).
 *
 * On remplace Alert.alert, sur le web uniquement, par les fenêtres du navigateur :
 *  - 0 ou 1 bouton  -> window.alert, puis l'action du bouton ;
 *  - 1 action + 1 bouton d'annulation -> window.confirm (OK = action) ;
 *  - plusieurs actions -> une confirmation par action, dans l'ordre.
 * Sur Android et iOS, rien ne change.
 */
const CANCEL_TEXT = /^(annuler|non\b|fermer|plus tard|cancel|no\b|retour)/i;

function isCancel(b: AlertButton): boolean {
  return b.style === 'cancel' || CANCEL_TEXT.test((b.text || '').trim());
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  (Alert as any).alert = (title?: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    const list = (buttons || []).filter(Boolean);

    if (list.length <= 1) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }

    const cancelBtn = list.find(isCancel);
    const actions = list.filter((b) => b !== cancelBtn);

    if (actions.length === 1) {
      if (window.confirm(text)) actions[0].onPress?.();
      else cancelBtn?.onPress?.();
      return;
    }

    for (const b of actions) {
      if (window.confirm(`${text}\n\n→ ${b.text} ?`)) {
        b.onPress?.();
        return;
      }
    }
    cancelBtn?.onPress?.();
  };
}

export {};

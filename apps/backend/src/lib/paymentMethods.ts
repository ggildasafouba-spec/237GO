/**
 * MOYENS DE PAIEMENT ACCEPTÉS POUR LES SERVICES
 * (course, livraison, covoiturage, location, commande GO Market)
 *
 * Pourquoi seulement WALLET et CASH :
 * l'encaissement Mobile Money (Orange Money / MTN MoMo) n'est branché QUE pour la
 * recharge du portefeuille. Pour un service payé "en Mobile Money", aucun argent n'était
 * réellement prélevé chez le client, alors que le prestataire était quand même crédité
 * à la fin. La plateforme aurait donc payé des chauffeurs avec de l'argent jamais reçu.
 *
 * Le client qui veut payer en Mobile Money le fait en DEUX étapes, déjà fonctionnelles :
 *   1. il recharge son portefeuille par Orange Money / MTN (encaissement réel via NotchPay) ;
 *   2. il paie le service avec son portefeuille.
 *
 * Pour réactiver le paiement direct Mobile Money sur un service, il faudra d'abord
 * brancher l'encaissement (paiement initié puis confirmé par webhook AVANT de bloquer l'escrow).
 */
export const SERVICE_PAYMENT_METHODS = ['WALLET', 'CASH'] as const;

export const SERVICE_PAYMENT_ERROR =
  'Paiement par portefeuille ou en espèces uniquement. ' +
  'Pour payer avec Orange Money ou MTN MoMo, rechargez d\'abord votre portefeuille.';

/**
 * Documents légaux de 237GO.
 * Changer TERMS_VERSION quand les CGU changent de façon importante : la version acceptée
 * par chaque utilisateur est enregistrée à l'inscription (User.termsVersion).
 */
export const TERMS_VERSION = '2026-11';

const SITE = (process.env.LEGAL_SITE_URL || 'https://www.237go.app').replace(/\/+$/, '');

export const LEGAL_URLS = {
  terms: `${SITE}/cgu.html`,
  privacy: `${SITE}/privacy.html`,
  legal: `${SITE}/mentions-legales.html`,
  deletion: `${SITE}/suppression-compte.html`,
};

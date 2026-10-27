// Affiche un numéro de téléphone avec son indicatif correct.
// - Numéro déjà au format international (commence par +) => affiché tel quel
//   (ex. diaspora : +33650222478)
// - Numéro local camerounais (ex. 6XXXXXXXX) => préfixé +237
export function formatPhone(phone: string | null | undefined): string {
  const p = (phone || '').trim();
  if (!p) return '';
  if (p.startsWith('+')) return p;
  return `+237 ${p}`;
}

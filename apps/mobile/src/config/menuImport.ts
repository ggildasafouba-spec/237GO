import { Linking, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import api, { API_BASE_URL } from './api';

export interface ParsedMenuRow {
  line: number;
  name: string;
  price: number | null;
  category: string;
  description: string;
  errors: string[];
  warnings: string[];
  action?: 'create' | 'update';
}

export interface MenuPreview {
  rows: ParsedMenuRow[];
  validCount: number;
  errorCount: number;
  createCount: number;
  updateCount: number;
}

/** Ouvre le modèle Excel (téléchargement par le navigateur / l'appli fichiers du téléphone). */
export async function openMenuTemplate() {
  const url = `${API_BASE_URL}/market/menu-template`;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank');
  } else {
    await Linking.openURL(url);
  }
}

/**
 * Choisit un fichier Excel/CSV puis demande au serveur de le lire.
 * Renvoie l'aperçu (rien n'est encore enregistré), ou null si l'utilisateur annule.
 */
export async function pickAndParseMenu(): Promise<MenuPreview | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'text/comma-separated-values',
      'application/vnd.ms-excel',
      'text/plain',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // Navigateur : il faut un vrai fichier (File/Blob), pas un objet { uri }
    const file = (asset as any).file ?? (await (await fetch(asset.uri)).blob());
    formData.append('file', file, asset.name);
  } else {
    formData.append('file', {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType || 'application/octet-stream',
    } as any);
  }

  const response = await api.post('/market/menu-import/parse', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.data as MenuPreview;
}

/** Enregistre les plats valides de l'aperçu dans la boutique. */
export async function commitMenuImport(rows: ParsedMenuRow[]) {
  const items = rows
    .filter((r) => r.errors.length === 0)
    .map((r) => ({ name: r.name, price: r.price, category: r.category, description: r.description }));
  const response = await api.post('/market/my-shop/menu-import', { items });
  return response.data as { message: string; data: { created: number; updated: number } };
}

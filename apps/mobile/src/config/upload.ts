import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import api from './api';

/**
 * Ouvre la galerie, laisse l'utilisateur choisir une image, puis l'upload au backend.
 * @returns l'URL publique du fichier, ou null si annulé/échoué
 */
export async function pickAndUploadImage(): Promise<string | null> {
  // Demander la permission d'accès à la galerie
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Permission d\'accès aux photos refusée');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    allowsEditing: true,
  });

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];

  // Construire le form-data
  const formData = new FormData();
  if (Platform.OS === 'web') {
    // Navigateur : un objet { uri } n'est pas un fichier (il était envoyé comme texte
    // « [object Object] » et refusé). Il faut un vrai File/Blob.
    const blob: Blob = (asset as any).file ?? (await (await fetch(asset.uri)).blob());
    const mime = blob.type || asset.mimeType || 'image/jpeg';
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    formData.append('file', blob, asset.fileName || `upload.${ext}`);
  } else {
    const uriParts = asset.uri.split('.');
    const ext = uriParts[uriParts.length - 1] || 'jpg';
    formData.append('file', {
      uri: asset.uri,
      name: `upload.${ext}`,
      type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    } as any);
  }

  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data.data.url as string;
}

import axios from 'axios';

/**
 * Service IA unifié pour 237GO.
 * Supporte OpenAI et Anthropic (Claude), configurable via AI_PROVIDER.
 *
 * Variables d'environnement :
 *   AI_PROVIDER   = 'claude' (défaut) | 'openai'
 *   AI_API_KEY    = clé API du fournisseur choisi
 *   AI_MODEL      = (optionnel) override du modèle
 */

type AiProvider = 'claude' | 'openai';

const PROVIDER: AiProvider = (process.env.AI_PROVIDER as AiProvider) || 'claude';
const API_KEY = process.env.AI_API_KEY || '';

const DEFAULT_MODELS: Record<AiProvider, string> = {
  claude: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o-mini',
};

const MODEL = process.env.AI_MODEL || DEFAULT_MODELS[PROVIDER];

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiImageInput {
  /** URL publique de l'image (permis, CNI...) */
  url: string;
}

export function isAiConfigured(): boolean {
  return Boolean(API_KEY);
}

/**
 * Génère une réponse texte à partir d'un prompt système + historique de messages.
 */
export async function aiChat(params: {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { system, messages, maxTokens = 1024, temperature = 0.4 } = params;

  if (!API_KEY) {
    throw new Error('IA non configurée (AI_API_KEY manquante)');
  }

  if (PROVIDER === 'openai') {
    return openAiChat(system, messages, maxTokens, temperature);
  }
  return claudeChat(system, messages, maxTokens, temperature);
}

/**
 * Analyse une image (document) + une consigne texte. Retourne la réponse de l'IA.
 * Utilisé pour la vérification des documents chauffeur.
 */
export async function aiVision(params: {
  system: string;
  prompt: string;
  imageUrl: string;
  maxTokens?: number;
}): Promise<string> {
  const { system, prompt, imageUrl, maxTokens = 1024 } = params;

  if (!API_KEY) {
    throw new Error('IA non configurée (AI_API_KEY manquante)');
  }

  if (PROVIDER === 'openai') {
    return openAiVision(system, prompt, imageUrl, maxTokens);
  }
  return claudeVision(system, prompt, imageUrl, maxTokens);
}

// ========== CLAUDE (Anthropic) ==========

async function claudeChat(system: string, messages: AiMessage[], maxTokens: number, temperature: number): Promise<string> {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    },
    {
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 30000,
    }
  );
  return response.data.content?.[0]?.text || '';
}

async function claudeVision(system: string, prompt: string, imageUrl: string, maxTokens: number): Promise<string> {
  // Claude accepte les images par URL ou base64. On télécharge et encode en base64
  // pour éviter les problèmes d'accès réseau depuis Anthropic.
  const { data, contentType } = await fetchImageBase64(imageUrl);

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: contentType, data } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    },
    {
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 40000,
    }
  );
  return response.data.content?.[0]?.text || '';
}

// ========== OPENAI ==========

async function openAiChat(system: string, messages: AiMessage[], maxTokens: number, temperature: number): Promise<string> {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'system', content: system }, ...messages],
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );
  return response.data.choices?.[0]?.message?.content || '';
}

async function openAiVision(system: string, prompt: string, imageUrl: string, maxTokens: number): Promise<string> {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 40000,
    }
  );
  return response.data.choices?.[0]?.message?.content || '';
}

// ========== HELPERS ==========

async function fetchImageBase64(url: string): Promise<{ data: string; contentType: string }> {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
  const rawType = res.headers['content-type'];
  const contentType = typeof rawType === 'string' ? rawType : 'image/jpeg';
  const data = Buffer.from(res.data, 'binary').toString('base64');
  return { data, contentType };
}

/**
 * Parse un JSON renvoyé par l'IA de façon robuste (gère les blocs ```json).
 */
export function parseAiJson<T = any>(text: string): T | null {
  try {
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(cleaned.substring(start, end + 1)) as T;
  } catch {
    return null;
  }
}

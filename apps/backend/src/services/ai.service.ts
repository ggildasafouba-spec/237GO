import axios from 'axios';

/**
 * Service IA unifié pour 237GO.
 * Supporte OpenAI, Anthropic (Claude) et Google (Gemini), configurable via AI_PROVIDER.
 *
 * Variables d'environnement :
 *   AI_PROVIDER   = 'gemini' | 'claude' | 'openai'   (défaut : gemini)
 *   AI_API_KEY    = clé API du fournisseur choisi
 *   AI_MODEL      = (optionnel) override du modèle
 */

type AiProvider = 'claude' | 'openai' | 'gemini';

const PROVIDER: AiProvider = (process.env.AI_PROVIDER as AiProvider) || 'gemini';
const API_KEY = process.env.AI_API_KEY || '';

const DEFAULT_MODELS: Record<AiProvider, string> = {
  claude: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o-mini',
  // Modèle Gemini stable et disponible sur le niveau gratuit (v1beta).
  // Surchargeable via AI_MODEL si besoin.
  gemini: 'gemini-2.5-flash',
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
  if (PROVIDER === 'gemini') {
    return geminiChat(system, messages, maxTokens, temperature);
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
  if (PROVIDER === 'gemini') {
    return geminiVision(system, prompt, imageUrl, maxTokens);
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

// ========== GEMINI (Google) ==========

async function geminiChat(system: string, messages: AiMessage[], maxTokens: number, temperature: number): Promise<string> {
  // Gemini : rôles 'user' / 'model' (l'assistant = 'model')
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const response = await geminiPostWithRetry({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  });

  return response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Cache de la liste des modèles disponibles (évite d'appeler ListModels à chaque requête).
let cachedGeminiModels: string[] | null = null;

/**
 * Demande à Google la liste des modèles réellement disponibles pour CETTE clé,
 * et ne garde que les modèles "flash" supportant generateContent.
 * Ça rend l'intégration robuste aux changements de génération (3.8, 3.6, 2.5...).
 */
async function listGeminiModels(): Promise<string[]> {
  if (cachedGeminiModels && cachedGeminiModels.length) return cachedGeminiModels;
  try {
    const res = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}&pageSize=100`,
      { timeout: 15000 }
    );
    const all = (res.data?.models || []) as Array<{
      name: string;
      supportedGenerationMethods?: string[];
    }>;
    const usable = all
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));

    // Priorité aux modèles "flash" (rapides + gratuits), puis le reste en secours.
    const flash = usable.filter((n) => n.includes('flash') && !n.includes('lite'));
    const flashLite = usable.filter((n) => n.includes('flash') && n.includes('lite'));
    const others = usable.filter((n) => !n.includes('flash'));
    cachedGeminiModels = [...flash, ...flashLite, ...others];
    return cachedGeminiModels;
  } catch (err: any) {
    console.error('Gemini ListModels error:', err?.response?.data || err.message);
    return [];
  }
}

/**
 * POST vers l'API Gemini avec réessais automatiques.
 * On essaie d'abord le modèle configuré (AI_MODEL), puis ceux réellement
 * disponibles pour la clé (découverts via ListModels). Fallback sur surcharge
 * (503/429) ou modèle introuvable (404/400).
 */
async function geminiPostWithRetry(payload: any): Promise<any> {
  const discovered = await listGeminiModels();
  const models = [MODEL, ...discovered]
    .filter((m) => !!m)
    .filter((m, i, arr) => arr.indexOf(m) === i); // dédoublonner

  let lastError: any;
  for (const model of models) {
    for (let i = 0; i < 2; i++) {
      try {
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
          payload,
          { headers: { 'Content-Type': 'application/json' }, timeout: 25000 }
        );
        return res.data;
      } catch (err: any) {
        lastError = err;
        const status = err?.response?.status;
        const isTimeout = err?.code === 'ECONNABORTED';
        // 503/429 = surcharge, 404/400 = modèle introuvable/non supporté
        // → on passe au modèle suivant de la liste.
        if (status === 503 || status === 429 || status === 404 || status === 400) break;
        // timeout → une 2e tentative sur le même modèle
        if (isTimeout && i === 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        throw err;
      }
    }
  }
  throw lastError;
}

async function geminiVision(system: string, prompt: string, imageUrl: string, maxTokens: number): Promise<string> {
  // Télécharger et encoder l'image en base64 (inline data)
  const { data, contentType } = await fetchImageBase64(imageUrl);

  const response = await geminiPostWithRetry({
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: contentType, data } },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: maxTokens },
  });

  return response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
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

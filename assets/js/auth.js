/**
 * auth.js — Sistema de autenticación OAuth 2.0 PKCE
 * iglitchoffstats | github.com/iglitchoff/iglitchoffstats
 *
 * SEGURIDAD:
 *  - Flujo PKCE: no requiere client_secret en el frontend.
 *  - El access_token SOLO se guarda en sessionStorage.
 *  - Al cerrar la pestaña, el token se elimina automáticamente.
 *  - Nunca se guarda nada en localStorage, cookies ni URLs.
 */

// ─── Configuración ───────────────────────────────────────────────────────────
// CLIENT_ID es público (no es un secreto). El client_secret NUNCA aparece aquí.
const KICK_CONFIG = {
  CLIENT_ID:         '01KK9JKQQ6V1MM0MFV6EFCFEDE',           // ← reemplazar con tu Client ID de Kick
  REDIRECT_URI:      `${window.location.origin}/pages/login.html`,
  AUTHORIZATION_URL: 'https://kick.com/oauth/authorize',
  TOKEN_URL:         'https://kick.com/oauth/token',
  USER_URL:          'https://kick.com/api/v2/channels/iglitchoff',
  SCOPES:            'channel:read user:read',
};

// ─── Claves de sessionStorage ─────────────────────────────────────────────────
const KEYS = {
  TOKEN:    'kick_oauth_access_token',
  VERIFIER: 'kick_pkce_verifier',
  STATE:    'kick_oauth_state',
  USER:     'kick_oauth_user',
};

// ─── Utilidades PKCE (RFC 7636) ───────────────────────────────────────────────

/**
 * Genera un string aleatorio URL-safe para el code_verifier.
 * Longitud: 64 bytes → ~86 chars base64url (dentro del rango 43–128 de la spec).
 * @returns {string}
 */
function generateVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/**
 * Genera el code_challenge a partir del code_verifier (S256).
 * @param {string} verifier
 * @returns {Promise<string>}
 */
async function generateChallenge(verifier) {
  const encoder = new TextEncoder();
  const data     = encoder.encode(verifier);
  const digest   = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

/**
 * Codifica un Uint8Array como base64url (sin padding).
 * @param {Uint8Array} buffer
 * @returns {string}
 */
function base64urlEncode(buffer) {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Genera un state aleatorio anti-CSRF.
 * @returns {string}
 */
function generateState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

// ─── API pública del módulo ───────────────────────────────────────────────────

/**
 * Genera y retorna el par { verifier, challenge } de PKCE.
 * Uso interno, pero exportado para testing.
 * @returns {Promise<{ verifier: string, challenge: string }>}
 */
export async function generatePKCE() {
  const verifier   = generateVerifier();
  const challenge  = await generateChallenge(verifier);
  return { verifier, challenge };
}

/**
 * Inicia el flujo OAuth 2.0 PKCE:
 * 1. Genera verifier + challenge.
 * 2. Guarda el verifier en sessionStorage (necesario para el callback).
 * 3. Redirige al endpoint de autorización de Kick.
 * @returns {Promise<void>}
 */
export async function initiateLogin() {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();

  // Guardar para usar en handleCallback
  sessionStorage.setItem(KEYS.VERIFIER, verifier);
  sessionStorage.setItem(KEYS.STATE, state);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             KICK_CONFIG.CLIENT_ID,
    redirect_uri:          KICK_CONFIG.REDIRECT_URI,
    scope:                 KICK_CONFIG.SCOPES,
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${KICK_CONFIG.AUTHORIZATION_URL}?${params}`;
}

/**
 * Maneja el callback de OAuth:
 * 1. Verifica el state anti-CSRF.
 * 2. Intercambia el authorization code por un access_token (PKCE, sin client_secret).
 * 3. Guarda el token en sessionStorage.
 * 4. Limpia parámetros sensibles de la URL.
 *
 * @param {URLSearchParams} urlParams — URLSearchParams del callback
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function handleCallback(urlParams) {
  const code          = urlParams.get('code');
  const returnedState = urlParams.get('state');
  const error         = urlParams.get('error');

  // Error explícito de Kick
  if (error) {
    return { success: false, error: `Kick OAuth error: ${error}` };
  }

  if (!code) {
    return { success: false, error: 'No se recibió authorization code.' };
  }

  // Verificar state anti-CSRF
  const savedState = sessionStorage.getItem(KEYS.STATE);
  if (!savedState || savedState !== returnedState) {
    sessionStorage.removeItem(KEYS.STATE);
    return { success: false, error: 'State mismatch — posible ataque CSRF.' };
  }

  const verifier = sessionStorage.getItem(KEYS.VERIFIER);
  if (!verifier) {
    return { success: false, error: 'Code verifier no encontrado en sesión.' };
  }

  try {
    const response = await fetch(KICK_CONFIG.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     KICK_CONFIG.CLIENT_ID,
        redirect_uri:  KICK_CONFIG.REDIRECT_URI,
        code,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Token endpoint respondió ${response.status}: ${errBody}`);
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new Error('La respuesta no contiene access_token.');
    }

    // Guardar token SOLO en sessionStorage
    sessionStorage.setItem(KEYS.TOKEN, data.access_token);

    // Limpiar datos temporales de PKCE
    sessionStorage.removeItem(KEYS.VERIFIER);
    sessionStorage.removeItem(KEYS.STATE);

    // Limpiar query params sensibles de la URL sin recargar la página
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Retorna el access_token de sessionStorage, o null si no existe.
 * @returns {string|null}
 */
export function getToken() {
  return sessionStorage.getItem(KEYS.TOKEN);
}

/**
 * Indica si hay una sesión activa.
 * @returns {boolean}
 */
export function isLoggedIn() {
  return getToken() !== null;
}

/**
 * Cierra sesión: elimina todos los datos de sessionStorage y redirige a index.
 */
export function logout() {
  sessionStorage.removeItem(KEYS.TOKEN);
  sessionStorage.removeItem(KEYS.USER);
  sessionStorage.removeItem(KEYS.VERIFIER);
  sessionStorage.removeItem(KEYS.STATE);
  window.location.href = `${window.location.origin}/index.html`;
}

/**
 * Obtiene los datos del usuario autenticado desde la API de Kick.
 * Los cachea en sessionStorage para no repetir la petición en cada navegación.
 * @returns {Promise<object|null>} Datos del usuario, o null si no hay sesión.
 */
export async function getUser() {
  if (!isLoggedIn()) return null;

  // Cache en sessionStorage
  const cached = sessionStorage.getItem(KEYS.USER);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* ignorar */ }
  }

  const token = getToken();
  try {
    const response = await fetch(KICK_CONFIG.USER_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expirado o inválido — limpiar sesión
        logout();
      }
      return null;
    }

    const user = await response.json();
    sessionStorage.setItem(KEYS.USER, JSON.stringify(user));
    return user;
  } catch {
    return null;
  }
}

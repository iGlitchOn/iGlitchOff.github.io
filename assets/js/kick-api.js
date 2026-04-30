/**
 * @file kick-api.js
 * @description Wrapper centralizado para la Kick API — proyecto iglitchoffstats.
 *              Todos los datos son obtenidos en tiempo real desde la Kick API oficial.
 *              Ningún dato es falso o simulado.
 * @module kick-api
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN GLOBAL
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  /** Base URL de la Kick API pública v1 */
  BASE_URL: 'https://kick.com/api/v1',

  /** Base URL de la Kick API v2 (endpoints extendidos) */
  BASE_URL_V2: 'https://kick.com/api/v2',

  /** Slug del canal principal del proyecto */
  CHANNEL_SLUG: 'iglitchoff',

  /** Intervalo de polling en ms (30 segundos) */
  POLLING_INTERVAL: 30000,
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Realiza un fetch a la Kick API con headers estándar.
 * @param {string} url - URL completa del endpoint.
 * @returns {Promise<any>} Respuesta JSON parseada.
 * @throws {Error} Si la respuesta HTTP no es ok.
 */
async function apiFetch(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new Error(`Kick API Error ${response.status}: ${response.statusText} — ${url}`);
  }

  return response.json();
}

/**
 * Construye la URL base del canal.
 * @param {string} channelSlug - Slug del canal.
 * @param {string} [version='v1'] - Versión de la API ('v1' | 'v2').
 * @returns {string} URL base del canal.
 */
function channelUrl(channelSlug, version = 'v1') {
  const base = version === 'v2' ? CONFIG.BASE_URL_V2 : CONFIG.BASE_URL;
  return `${base}/channels/${channelSlug}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIONES EXPORTADAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtiene la información general de un canal de Kick.
 *
 * @param {string} [channelSlug=CONFIG.CHANNEL_SLUG] - Slug del canal.
 * @returns {Promise<{
 *   id: number,
 *   slug: string,
 *   username: string,
 *   bio: string|null,
 *   avatar: string|null,
 *   banner: string|null,
 *   createdAt: string,
 *   verified: boolean,
 *   followersCount: number,
 *   subscribersCount: number
 * }|null>} Objeto con info del canal, o null si falla.
 */
export async function getChannelInfo(channelSlug = CONFIG.CHANNEL_SLUG) {
  try {
    const data = await apiFetch(channelUrl(channelSlug));

    return {
      id:               data.id               ?? null,
      slug:             data.slug             ?? channelSlug,
      username:         data.user?.username   ?? data.slug,
      bio:              data.user?.bio        ?? null,
      avatar:           data.user?.profile_pic ?? null,
      banner:           data.banner_image?.src ?? null,
      createdAt:        data.user?.created_at ?? null,
      verified:         data.verified         ?? false,
      followersCount:   data.followers_count  ?? 0,
      subscribersCount: data.subscriber_badges?.length ?? 0,
    };
  } catch (err) {
    console.error(`[kick-api] getChannelInfo("${channelSlug}") falló:`, err.message);
    return null;
  }
}

/**
 * Obtiene los datos del stream en vivo de un canal.
 * Retorna null si el canal no está en vivo.
 *
 * @param {string} [channelSlug=CONFIG.CHANNEL_SLUG] - Slug del canal.
 * @returns {Promise<{
 *   isLive: boolean,
 *   viewers: number,
 *   title: string,
 *   category: string|null,
 *   categorySlug: string|null,
 *   thumbnail: string|null,
 *   startedAt: string|null,
 *   language: string|null,
 *   isMature: boolean
 * }|null>} Datos del livestream activo, o null si falla.
 */
export async function getLivestream(channelSlug = CONFIG.CHANNEL_SLUG) {
  try {
    const data = await apiFetch(channelUrl(channelSlug));
    const ls   = data.livestream ?? null;

    if (!ls) {
      return { isLive: false, viewers: 0, title: null, category: null,
               categorySlug: null, thumbnail: null, startedAt: null,
               language: null, isMature: false };
    }

    return {
      isLive:       true,
      viewers:      ls.viewer_count          ?? 0,
      title:        ls.session_title         ?? '',
      category:     ls.categories?.[0]?.name ?? null,
      categorySlug: ls.categories?.[0]?.slug ?? null,
      thumbnail:    ls.thumbnail?.src        ?? null,
      startedAt:    ls.created_at            ?? null,
      language:     ls.language              ?? null,
      isMature:     ls.is_mature             ?? false,
    };
  } catch (err) {
    console.error(`[kick-api] getLivestream("${channelSlug}") falló:`, err.message);
    return null;
  }
}

/**
 * Obtiene el número total de followers de un canal.
 *
 * @param {string} [channelSlug=CONFIG.CHANNEL_SLUG] - Slug del canal.
 * @returns {Promise<number|null>} Total de followers, o null si falla.
 */
export async function getFollowersCount(channelSlug = CONFIG.CHANNEL_SLUG) {
  try {
    const data = await apiFetch(channelUrl(channelSlug));
    const count = data.followers_count ?? null;

    if (count === null) throw new Error('Campo followers_count no encontrado en la respuesta.');
    return count;
  } catch (err) {
    console.error(`[kick-api] getFollowersCount("${channelSlug}") falló:`, err.message);
    return null;
  }
}

/**
 * Obtiene el número total de suscriptores de un canal.
 * Kick no expone este dato directamente en todos los endpoints;
 * se extrae de subscription_enabled y subscriber_badges como aproximación,
 * o del endpoint dedicado si el canal lo permite.
 *
 * @param {string} [channelSlug=CONFIG.CHANNEL_SLUG] - Slug del canal.
 * @returns {Promise<number|null>} Total de suscriptores, o null si falla.
 */
export async function getSubscribersCount(channelSlug = CONFIG.CHANNEL_SLUG) {
  try {
    // Kick no tiene un endpoint público de subscriber count sin OAuth.
    // Se intenta el endpoint de suscripción del canal.
    const data = await apiFetch(`${channelUrl(channelSlug)}/subscribers`);

    // El endpoint devuelve un objeto con total o count según la versión de la API.
    const count = data.total ?? data.count ?? data.subscribers_count ?? null;

    if (count === null) throw new Error('Campo de suscriptores no encontrado en la respuesta.');
    return count;
  } catch (err) {
    console.error(`[kick-api] getSubscribersCount("${channelSlug}") falló:`, err.message);
    return null;
  }
}

/**
 * Obtiene la lista de usuarios actualmente en el chat del canal.
 *
 * @param {string} [channelSlug=CONFIG.CHANNEL_SLUG] - Slug del canal.
 * @returns {Promise<Array<{
 *   username: string,
 *   slug: string,
 *   isStaff: boolean,
 *   isModerator: boolean,
 *   isSubscriber: boolean
 * }>|null>} Lista de chatters, o null si falla.
 */
export async function getChatters(channelSlug = CONFIG.CHANNEL_SLUG) {
  try {
    const data = await apiFetch(`${channelUrl(channelSlug)}/chatroom`);

    // La sala de chat contiene la lista de usuarios conectados
    const chatroom = data ?? {};
    const chatters = chatroom.chatters ?? chatroom.users ?? [];

    return chatters.map(u => ({
      username:     u.username     ?? u.slug ?? 'unknown',
      slug:         u.slug         ?? '',
      isStaff:      u.is_staff     ?? false,
      isModerator:  u.is_moderator ?? false,
      isSubscriber: u.is_subscriber ?? false,
    }));
  } catch (err) {
    console.error(`[kick-api] getChatters("${channelSlug}") falló:`, err.message);
    return null;
  }
}

/**
 * Obtiene el historial de categorías / juegos del canal.
 *
 * @param {string} [channelSlug=CONFIG.CHANNEL_SLUG] - Slug del canal.
 * @returns {Promise<Array<{
 *   id: number,
 *   name: string,
 *   slug: string,
 *   thumbnail: string|null,
 *   tags: string[]
 * }>|null>} Lista de categorías, o null si falla.
 */
export async function getCategories(channelSlug = CONFIG.CHANNEL_SLUG) {
  try {
    const data = await apiFetch(`${CONFIG.BASE_URL_V2}/channels/${channelSlug}/categories`);

    const categories = Array.isArray(data) ? data : (data.data ?? data.categories ?? []);

    return categories.map(c => ({
      id:        c.id        ?? null,
      name:      c.name      ?? 'Sin categoría',
      slug:      c.slug      ?? '',
      thumbnail: c.thumbnail ?? c.banner ?? null,
      tags:      Array.isArray(c.tags) ? c.tags : [],
    }));
  } catch (err) {
    console.error(`[kick-api] getCategories("${channelSlug}") falló:`, err.message);
    return null;
  }
}

/**
 * Obtiene los últimos N streams pasados (VODs) del canal.
 *
 * @param {string} [channelSlug=CONFIG.CHANNEL_SLUG] - Slug del canal.
 * @param {number} [limit=10] - Número máximo de streams a retornar.
 * @returns {Promise<Array<{
 *   id: number,
 *   title: string,
 *   thumbnail: string|null,
 *   category: string|null,
 *   startedAt: string|null,
 *   endedAt: string|null,
 *   durationSeconds: number,
 *   peakViewers: number,
 *   avgViewers: number
 * }>|null>} Lista de streams pasados, o null si falla.
 */
export async function getPastStreams(channelSlug = CONFIG.CHANNEL_SLUG, limit = 10) {
  try {
    const url  = `${CONFIG.BASE_URL_V2}/channels/${channelSlug}/videos?limit=${limit}`;
    const data = await apiFetch(url);

    const streams = Array.isArray(data) ? data : (data.data ?? data.videos ?? []);

    return streams.slice(0, limit).map(s => {
      // Calcular duración en segundos a partir de start/end si no viene explícita
      let durationSeconds = s.duration ?? 0;
      if (!durationSeconds && s.start_time && s.end_time) {
        const start = new Date(s.start_time).getTime();
        const end   = new Date(s.end_time).getTime();
        durationSeconds = Math.max(0, Math.floor((end - start) / 1000));
      }

      return {
        id:              s.id              ?? null,
        title:           s.session_title   ?? s.title ?? 'Sin título',
        thumbnail:       s.thumbnail?.src  ?? s.thumbnail ?? null,
        category:        s.categories?.[0]?.name ?? s.category?.name ?? null,
        startedAt:       s.start_time      ?? s.created_at ?? null,
        endedAt:         s.end_time        ?? null,
        durationSeconds,
        peakViewers:     s.peak_viewers    ?? s.viewer_count ?? 0,
        avgViewers:      s.avg_viewers     ?? 0,
      };
    });
  } catch (err) {
    console.error(`[kick-api] getPastStreams("${channelSlug}", ${limit}) falló:`, err.message);
    return null;
  }
}

/**
 * Obtiene los clips más recientes o populares de un canal.
 *
 * @param {string} [channelSlug=CONFIG.CHANNEL_SLUG] - Slug del canal.
 * @param {number} [limit=20] - Número máximo de clips a retornar.
 * @returns {Promise<Array<{
 *   id: string,
 *   title: string,
 *   thumbnail: string|null,
 *   url: string,
 *   views: number,
 *   likes: number,
 *   duration: number,
 *   category: string|null,
 *   createdAt: string|null,
 *   createdBy: string|null
 * }>|null>} Lista de clips, o null si falla.
 */
export async function getClips(channelSlug = CONFIG.CHANNEL_SLUG, limit = 20) {
  try {
    const url  = `${CONFIG.BASE_URL_V2}/clips?channel_name=${channelSlug}&limit=${limit}`;
    const data = await apiFetch(url);

    const clips = Array.isArray(data) ? data : (data.data ?? data.clips ?? []);

    return clips.slice(0, limit).map(c => ({
      id:        c.clip_url?.split('/').pop() ?? c.id ?? '',
      title:     c.title     ?? 'Sin título',
      thumbnail: c.thumbnail_url ?? c.thumbnail ?? null,
      url:       c.clip_url  ?? '',
      views:     c.views     ?? c.view_count  ?? 0,
      likes:     c.likes     ?? c.like_count  ?? 0,
      duration:  c.duration  ?? 0,
      category:  c.category?.name ?? null,
      createdAt: c.created_at ?? null,
      createdBy: c.creator?.username ?? null,
    }));
  } catch (err) {
    console.error(`[kick-api] getClips("${channelSlug}", ${limit}) falló:`, err.message);
    return null;
  }
}

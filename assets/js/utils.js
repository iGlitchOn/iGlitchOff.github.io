/**
 * @file utils.js
 * @description Helpers reutilizables para el proyecto iglitchoffstats.
 *              Formateo de números, fechas, duraciones, colores y utilidades generales.
 * @module utils
 */

// ─────────────────────────────────────────────────────────────────────────────
// FORMATEO NUMÉRICO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatea un número según su magnitud.
 * - Menos de 10.000 → separador de miles con punto: "9.542"
 * - 10.000 – 999.999 → abreviado a miles:    "11.7K"
 * - 1.000.000+        → abreviado a millones: "3.4M"
 *
 * @param {number|string|null|undefined} n - Número a formatear.
 * @returns {string} Número formateado o "—" si el valor no es válido.
 *
 * @example
 * formatNumber(542)       // "542"
 * formatNumber(11685)     // "11.7K"
 * formatNumber(3400000)   // "3.4M"
 */
export function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';

  if (Math.abs(num) >= 1_000_000) {
    // Millones con un decimal
    return `${(num / 1_000_000).toFixed(1).replace('.', ',')}M`;
  }

  if (Math.abs(num) >= 10_000) {
    // Miles con un decimal
    return `${(num / 1_000).toFixed(1).replace('.', ',')}K`;
  }

  // Separador de miles con punto (estilo ES/LATAM)
  return num.toLocaleString('es-CO');
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATEO DE DURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convierte segundos a un string legible de duración.
 *
 * @param {number|null|undefined} seconds - Duración en segundos.
 * @returns {string} Duración formateada, ej. "7h 49min" | "43min" | "58s" | "—"
 *
 * @example
 * formatDuration(28140)  // "7h 49min"
 * formatDuration(2580)   // "43min"
 * formatDuration(58)     // "58s"
 * formatDuration(0)      // "0s"
 */
export function formatDuration(seconds) {
  const secs = Math.floor(Number(seconds));
  if (!Number.isFinite(secs) || secs < 0) return '—';

  if (secs === 0) return '0s';

  const h   = Math.floor(secs / 3600);
  const min = Math.floor((secs % 3600) / 60);
  const s   = secs % 60;

  if (h > 0) {
    return min > 0 ? `${h}h ${min}min` : `${h}h`;
  }
  if (min > 0) {
    return s > 0 ? `${min}min ${s}s` : `${min}min`;
  }
  return `${s}s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATEO DE FECHAS
// ─────────────────────────────────────────────────────────────────────────────

/** Nombres de meses en español abreviados (3 letras). */
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                   'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Formatea una fecha ISO a un string legible en español.
 *
 * @param {string|number|Date|null|undefined} isoString - Fecha en formato ISO 8601 u otro parseable.
 * @returns {string} Fecha formateada, ej. "13 abr 2026 · 03:25" | "—"
 *
 * @example
 * formatDate('2026-04-13T03:25:00Z')  // "13 abr 2026 · 03:25"
 */
export function formatDate(isoString) {
  if (!isoString) return '—';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '—';

  const day   = String(date.getDate()).padStart(2, '0');
  const month = MONTHS_ES[date.getMonth()];
  const year  = date.getFullYear();
  const hh    = String(date.getHours()).padStart(2, '0');
  const mm    = String(date.getMinutes()).padStart(2, '0');

  return `${day} ${month} ${year} · ${hh}:${mm}`;
}

/**
 * Devuelve el tiempo relativo desde una fecha hasta ahora, en español.
 *
 * @param {string|number|Date|null|undefined} isoString - Fecha de referencia.
 * @returns {string} Tiempo relativo, ej. "hace 2 días" | "hace 3 horas" | "justo ahora" | "—"
 *
 * @example
 * getRelativeTime('2026-04-11T10:00:00Z')  // "hace 2 días"
 * getRelativeTime('2026-04-13T02:55:00Z')  // "hace 30 minutos"
 */
export function getRelativeTime(isoString) {
  if (!isoString) return '—';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '—';

  const diffMs      = Date.now() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 0)   return 'en el futuro';
  if (diffSeconds < 60)  return 'justo ahora';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `hace ${diffMinutes} ${diffMinutes === 1 ? 'minuto' : 'minutos'}`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `hace ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `hace ${diffMonths} ${diffMonths === 1 ? 'mes' : 'meses'}`;
  }

  const diffYears = Math.floor(diffMonths / 12);
  return `hace ${diffYears} ${diffYears === 1 ? 'año' : 'años'}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERACIÓN DE NOMBRES DE ARCHIVO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera un nombre de archivo JSON para guardar datos de un stream,
 * basado en su fecha/hora de inicio.
 * Formato: "YYYY-MM-DD_HH-mm.json"
 * Ruta sugerida: /data/streams/<resultado>
 *
 * @param {string|number|Date|null|undefined} startedAt - Fecha/hora de inicio del stream.
 * @returns {string} Nombre de archivo, ej. "2026-04-13_03-10.json" | "stream_unknown.json"
 *
 * @example
 * generateStreamFileName('2026-04-13T03:10:00Z')  // "2026-04-13_03-10.json"
 */
export function generateStreamFileName(startedAt) {
  if (!startedAt) return 'stream_unknown.json';

  const date = new Date(startedAt);
  if (isNaN(date.getTime())) return 'stream_unknown.json';

  const YYYY = date.getFullYear();
  const MM   = String(date.getMonth() + 1).padStart(2, '0');
  const DD   = String(date.getDate()).padStart(2, '0');
  const HH   = String(date.getHours()).padStart(2, '0');
  const mm   = String(date.getMinutes()).padStart(2, '0');

  return `${YYYY}-${MM}-${DD}_${HH}-${mm}.json`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR INTERPOLADO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interpola un color hex entre rojo (#ff4444) y verde (#53fc18)
 * según la posición de `value` en el rango [min, max].
 *
 * - value ≤ min → rojo  (#ff4444)
 * - value ≥ max → verde (#53fc18)
 * - valores intermedios → interpolación HSL suave
 *
 * @param {number} value - Valor actual.
 * @param {number} min   - Límite inferior del rango.
 * @param {number} max   - Límite superior del rango.
 * @returns {string} Color hex de 7 caracteres, ej. "#a8d410"
 *
 * @example
 * getColorByValue(50, 0, 100)   // "#a8d410"  (amarillo-verde, mitad)
 * getColorByValue(0,  0, 100)   // "#ff4444"  (rojo)
 * getColorByValue(100, 0, 100)  // "#53fc18"  (verde Kick)
 */
export function getColorByValue(value, min, max) {
  // Paleta del proyecto: rojo → amarillo → verde Kick
  const RED   = { r: 0xff, g: 0x44, b: 0x44 }; // #ff4444
  const GREEN = { r: 0x53, g: 0xfc, b: 0x18 }; // #53fc18

  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return '#888888';
  }

  // Normalizar a [0, 1], clampeado
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));

  const r = Math.round(RED.r + (GREEN.r - RED.r) * t);
  const g = Math.round(RED.g + (GREEN.g - RED.g) * t);
  const b = Math.round(RED.b + (GREEN.b - RED.b) * t);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEBOUNCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve una versión debounced de la función `fn`.
 * Solo ejecuta `fn` después de que hayan pasado `ms` milisegundos
 * desde la última llamada.
 *
 * @template {(...args: any[]) => any} T
 * @param {T} fn - Función a debouncear.
 * @param {number} ms - Tiempo de espera en milisegundos.
 * @returns {(...args: Parameters<T>) => void} Función debounced.
 *
 * @example
 * const onResize = debounce(() => recalcLayout(), 250);
 * window.addEventListener('resize', onResize);
 */
export function debounce(fn, ms) {
  if (typeof fn !== 'function') throw new TypeError('[utils] debounce: fn debe ser una función.');
  if (typeof ms !== 'number' || ms < 0) throw new TypeError('[utils] debounce: ms debe ser un número ≥ 0.');

  let timeoutId = null;

  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn.apply(this, args);
    }, ms);
  };
}

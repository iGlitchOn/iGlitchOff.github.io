# iglitchoff · KickStats Dashboard
## Instalación en 3 pasos

### Paso 1 – Configura la Redirect URL en Kick

1. Ve a https://kick.com/settings/developer
2. Abre tu app **KickX**
3. En **Redirect URL** pon exactamente:
   ```
   file:///RUTA_A_TU_CARPETA/kickstats/index.html
   ```
   **O mejor aún**, ábrela con Live Server (VS Code):
   ```
   http://127.0.0.1:5500/kickstats/index.html
   ```
   Y pon esa URL en Kick.

4. Activa **Enable webhooks** → NO es necesario por ahora.
5. Guarda la app y copia tu **Client ID** y **Client Secret**.

---

### Paso 2 – Abre la app

**Opción A (más fácil):** Instala la extensión "Live Server" en VS Code, abre la carpeta `kickstats`, click derecho en `index.html` → "Open with Live Server".

**Opción B:** Abre `index.html` directamente en Chrome (doble click).
> ⚠️ Si abres directo con `file://`, la OAuth NO funcionará. En ese caso la app igual funciona con la API pública de Kick (sin autenticación) — solo tendrás menos datos.

---

### Paso 3 – Conecta tu cuenta

1. Haz click en **"🔗 Conectar Kick"** en la sidebar.
2. Pega tu **Client ID** y **Client Secret** de KickX.
3. Escribe tu usuario: `iglitchoff`
4. Click **"Guardar y Conectar"** → te redirige a Kick para autorizar.
5. ¡Listo! Los datos se sincronizan automáticamente cada 30 segundos.

---

## Funciones

| Página | Descripción |
|--------|-------------|
| **Dashboard** | Vista general, stream en vivo, todos los stats |
| **Streams** | Historial completo, exportar CSV |
| **Seguidores** | Gráfico de crecimiento diario/semanal/mensual, ETA meta 1K |
| **Viewers** | Tendencia, distribución, top streams |
| **Horario** | Días activos, horas de inicio, heatmap semanal |
| **Por Stream** | Gráfico tipo TVTOP de viewers durante el stream |

## Almacenamiento

Todos los datos se guardan en **IndexedDB** del navegador — no se envía nada a ningún servidor. Los datos persisten entre sesiones.

Para **respaldar/migrar** datos: usa el botón de exportar en el dashboard.

---

## Sin OAuth (modo público)

Si no quieres usar OAuth, deja el Client ID vacío y solo escribe tu usuario. La app usará la API pública de Kick (con limitaciones). Los streams históricos se obtienen de los videos públicos del canal.

---

## Estructura de archivos

```
kickstats/
├── index.html          ← Dashboard principal
├── css/
│   └── style.css       ← Estilos
├── js/
│   ├── db.js           ← Base de datos (IndexedDB)
│   ├── kick-api.js     ← Cliente API Kick + OAuth2
│   ├── charts.js       ← Gráficos (Chart.js)
│   └── dashboard.js    ← Lógica del dashboard
└── pages/
    ├── streams.html    ← Historial de streams
    ├── followers.html  ← Análisis de seguidores
    ├── viewers.html    ← Análisis de viewers
    ├── schedule.html   ← Análisis de horario
    └── stream-detail.html  ← Detalle por stream (estilo TVTOP)
```

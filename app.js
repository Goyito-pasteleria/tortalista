/* =========================================================
   TortaLista · lógica de la PWA
   - Vista cliente: formulario de pedido + respaldo offline
   - Vista admin: login Supabase, listado en tiempo real,
     filtros, cambio de estado y borrado
   ========================================================= */
'use strict';

/* ---------- 1. CONFIGURACIÓN: pegá acá tus credenciales ---------- */
// Supabase → Project Settings → API
const SUPABASE_URL = 'https://naewanjjdevhsstenjja.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hAMx8mm97WgxtbElb1HtIw_Err6Kxbz';

const TABLA = 'pedidos_tortas';
const BUCKET = 'referencias';                     // fotos de ejemplo (privado)
const BUCKET_COMPROBANTES = 'comprobantes';       // comprobantes de la seña (privado)
const COLA_KEY = 'tortalista_pedidos_pendientes'; // respaldo local
// Pendiente = esperando la seña · Confirmado = la pastelería recibió la seña
const ESTADOS = ['Pendiente', 'Confirmado', 'En Proceso', 'Entregado'];
const MAX_RELLENOS = 3;
const MAX_COMPROBANTE = 5 * 1024 * 1024;          // 5 MB (mismo límite que el bucket)

/* ---------- Seña ----------
   SENA_MINIMA: si la cambiás acá, cambiala también en supabase-actualizacion-6.sql (sena >= 10000) */
const SENA_MINIMA = 10000;
const DATOS_TRANSFERENCIA = {
  alias: 'elgoyito',
  cvu: '0000003100046192447489',
  titular: 'Gabriela Gisela Martin Quinteros',
  cuit: '23368376434',
  banco: 'Mercado Pago',
};

/* ---------- Rellenos de las tortas personalizadas ----------
   - variantes: el cliente elige una (se guarda "nombre + variante", ej. "Ganache de chocolate blanco")
   - detalle: aclaración que se muestra en el botón */
const RELLENOS = [
  { nombre: 'Dulce de leche', variantes: ['con chips de chocolate', 'con merenguitos', 'con nueces'] },
  { nombre: 'Crema de leche', variantes: ['con frutillas', 'con duraznos'] },
  { nombre: 'Ganache de chocolate', variantes: ['blanco', 'semi amargo', 'con leche'] },
  { nombre: 'Crema de limón' },
  { nombre: 'Relleno de chocotorta' },
  { nombre: 'Crema Oreo con Oreos' },
  { nombre: 'Mousse', variantes: ['de chocolate', 'de dulce de leche'] },
  { nombre: 'Crema moka' },
  { nombre: 'Bananita Dolca' },
  { nombre: 'Crema Bariloche', detalle: 'chocolate, cerezas, dulce de leche y nueces' },
  { nombre: 'Crema granizada', detalle: 'crema de leche con chocolate' },
  { nombre: 'Crema rusa', detalle: 'de nueces' },
];

/* ---------- Tortas listas (catálogo) ----------
   Para cambiar el catálogo, editá esta lista:
   - precio: número (ej. 28000) para mostrar "Desde $..." como referencia, o null para no mostrarlo
     (el precio final siempre lo define la pastelería)
   - imagen: ruta de una foto (ej. './img/oreo.jpg') o null para usar el emoji
   - sabor: 'Chocolate' o 'Vainilla' (la base de datos solo acepta esos dos) · rellenos: máximo 3 */
const TORTAS_LISTAS = [
  // De chocolate
  { id: 'selva-negra', nombre: 'Selva Negra', descripcion: 'Crema de leche con cerezas y ganache de chocolate.',
    sabor: 'Chocolate', rellenos: ['Crema de leche', 'Cerezas', 'Ganache de chocolate'], emoji: '🍒', precio: null, imagen: null },
  { id: 'oreo', nombre: 'Oreo', descripcion: 'Crema de leche con galletitas Oreo y dulce de leche.',
    sabor: 'Chocolate', rellenos: ['Crema de leche', 'Galletitas Oreo', 'Dulce de leche'], emoji: '🍪', precio: null, imagen: null },
  { id: 'bariloche', nombre: 'Bariloche', descripcion: 'Crema de leche con frutillas y crema Bariloche.',
    sabor: 'Chocolate', rellenos: ['Crema de leche', 'Frutillas', 'Crema Bariloche'], emoji: '🍫', precio: null, imagen: null },
  // De vainilla
  { id: 'chaja', nombre: 'Chajá', descripcion: 'Crema con duraznos y dulce de leche con nuez.',
    sabor: 'Vainilla', rellenos: ['Crema', 'Duraznos', 'Dulce de leche con nuez'], emoji: '🍑', precio: null, imagen: null },
  { id: 'frutillas', nombre: 'Frutillas', descripcion: 'Crema de leche con frutillas y dulce de leche con chips.',
    sabor: 'Vainilla', rellenos: ['Crema de leche', 'Frutillas', 'Dulce de leche con chips'], emoji: '🍓', precio: null, imagen: null },
  { id: 'frutal', nombre: 'Frutal', descripcion: 'Crema con duraznos y crema con frutillas.',
    sabor: 'Vainilla', rellenos: ['Crema con duraznos', 'Crema con frutillas'], emoji: '🍰', precio: null, imagen: null },
  { id: 'moka', nombre: 'Moka', descripcion: 'Crema moka y dulce de leche.',
    sabor: 'Vainilla', rellenos: ['Crema moka', 'Dulce de leche'], emoji: '☕', precio: null, imagen: null },
];

/* ---------- 2. Cliente Supabase (defensivo) ---------- */
const configurado = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-ANON');
let sb = null;
try {
  if (configurado && window.supabase?.createClient) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
} catch (err) {
  console.error('No se pudo iniciar Supabase:', err);
}

/* ---------- 3. Utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtPeso = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const dinero = (n) => fmtPeso.format(Number(n) || 0);
const fmtPesoEntero = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

const fmtFecha = (iso) => {
  const d = new Date(iso);
  return {
    dia: d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
    hora: d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  };
};

const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/**
 * Notificación tipo Sonner:
 * - entra y sale por el mismo lado (abajo); la salida es más rápida
 * - usa transiciones (interrumpibles) con el patrón data-mounted
 * - el tiempo se pausa si la pestaña está oculta (no se pierde un aviso en la tablet)
 * - un toque la cierra
 */
function toast(msg, tipo = '', ms = 4500) {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => (el.dataset.mounted = 'true')));

  let restante = ms;
  let inicio = 0;
  let timer = null;
  let cerrado = false;

  const salir = () => {
    if (cerrado) return;
    cerrado = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    el.dataset.leaving = 'true';
    setTimeout(() => el.remove(), 220);
  };
  const correr = () => {
    inicio = Date.now();
    timer = setTimeout(salir, restante);
  };
  function alCambiarVisibilidad() {
    if (document.hidden) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        restante -= Date.now() - inicio;
      }
    } else if (!timer && !cerrado) {
      correr();
    }
  }

  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  el.addEventListener('click', salir);
  if (!document.hidden) correr();
}

/** Cambia el texto de un botón disimulando el salto con un blur leve. */
function setLabel(btn, texto) {
  const label = btn.querySelector('.btn-label') || btn;
  if (label.textContent === texto) return;
  label.classList.add('swapping');
  setTimeout(() => {
    label.textContent = texto;
    label.classList.remove('swapping');
  }, 100);
}

/** ¿El error viene de falta de conexión (y no de validación/permisos)? */
function esErrorDeRed(err) {
  if (!navigator.onLine) return true;
  const msg = String(err?.message || err || '');
  return !err?.code && /fetch|network|load failed|timeout|conexi/i.test(msg);
}

/* ---------- 4. Cola offline en localStorage ---------- */
function leerCola() {
  try {
    return JSON.parse(localStorage.getItem(COLA_KEY)) || [];
  } catch {
    return [];
  }
}
function guardarCola(cola) {
  try {
    localStorage.setItem(COLA_KEY, JSON.stringify(cola));
    return true;
  } catch (err) {
    console.error('localStorage no disponible:', err);
    return false;
  }
}
/** Normaliza un elemento de la cola: { pedido, imagen, comprobante } (archivos como dataURL o null) */
const itemCola = (x) => (x && x.pedido ? { comprobante: null, ...x } : { pedido: x, imagen: null, comprobante: null });

/** Guarda el pedido (y sus archivos) en el dispositivo. Devuelve 'ok', 'parcial' (sin algún archivo) o false. */
function encolar(pedido, imagen = null, comprobante = null) {
  const cola = leerCola().map(itemCola);
  if (cola.some((x) => x.pedido.id === pedido.id)) return 'ok';
  const item = { pedido, imagen, comprobante };
  cola.push(item);
  if (guardarCola(cola)) return 'ok';
  // Si los archivos no entran en el almacenamiento, se guarda el pedido sin ellos (primero se descarta la foto de ejemplo)
  for (const campo of ['imagen', 'comprobante']) {
    if (!item[campo]) continue;
    item[campo] = null;
    if (guardarCola(cola)) return 'parcial';
  }
  return false;
}
function actualizarAvisoCola() {
  const n = leerCola().length;
  const el = $('#pending-notice');
  el.hidden = n === 0;
  if (n) el.textContent = `Tenés ${n} pedido${n > 1 ? 's' : ''} guardado${n > 1 ? 's' : ''} en este dispositivo esperando conexión. Se enviarán automáticamente.`;
}

/** Inserta un pedido. Lanza error si falla. */
async function insertarPedido(pedido) {
  if (!sb) throw new Error('network: Supabase no disponible');
  // Sin .select(): el cliente anónimo solo tiene permiso de INSERT.
  // precio_total va siempre vacío (también en pedidos viejos guardados sin conexión).
  const { error } = await sb.from(TABLA).insert({ ...pedido, precio_total: null });
  // 23505 = clave duplicada → ya se había enviado en un intento previo.
  if (error && error.code !== '23505') throw error;
}

const rutaImagen = (pedidoId) => `${pedidoId}/referencia.jpg`;
const rutaComprobante = (pedidoId, tipo) => `${pedidoId}/comprobante.${tipo === 'application/pdf' ? 'pdf' : 'jpg'}`;

/** Sube un archivo a un bucket privado. */
async function subirArchivo(bucket, ruta, blob) {
  if (!sb) throw new Error('network: Supabase no disponible');
  const { error } = await sb.storage.from(bucket).upload(ruta, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  // "Ya existe" → se había subido en un intento previo
  if (error && !/exist|duplicate/i.test(error.message || '') && String(error.statusCode) !== '409') throw error;
}

/**
 * Envía un pedido completo: primero los datos y después los archivos (foto de ejemplo y comprobante).
 * La base solo acepta un archivo si ya existe el pedido que lo espera.
 * Devuelve la lista de archivos que no se pudieron guardar ([] = todo bien).
 * El comprobante_path ya viene en el pedido (se declara al crearlo, aunque el archivo se pierda).
 */
async function enviarPedidoCompleto(pedido, blob, comprobante = null) {
  pedido.imagen_path = blob ? rutaImagen(pedido.id) : null;
  await insertarPedido(pedido);
  const faltan = [];
  const archivos = [
    ['imagen', blob, BUCKET, pedido.imagen_path],
    ['comprobante', comprobante, BUCKET_COMPROBANTES, pedido.comprobante_path],
  ];
  for (const [nombre, archivo, bucket, ruta] of archivos) {
    if (!ruta) continue;
    if (!archivo) { faltan.push(nombre); continue; }
    try {
      await subirArchivo(bucket, ruta, archivo);
    } catch (err) {
      if (esErrorDeRed(err)) throw err; // se reintenta desde la cola (el pedido y los archivos repetidos se ignoran)
      console.warn(`El pedido se guardó, pero ${nombre} no:`, err);
      faltan.push(nombre);
    }
  }
  return faltan;
}

/** Límites anti-spam de la base (ver supabase-actualizacion-5.sql) */
function mensajeLimite(err) {
  const msg = String(err?.message || '');
  if (msg.includes('TL_LIMITE_TELEFONO')) return 'Ya recibimos varios pedidos desde este teléfono en la última hora. Esperá un rato o escribinos por WhatsApp.';
  if (msg.includes('TL_LIMITE_GLOBAL')) return 'Estamos recibiendo muchos pedidos en este momento. Probá de nuevo en unos minutos.';
  return null;
}

let sincronizando = false;
async function sincronizarCola() {
  if (sincronizando || !navigator.onLine || !sb) return;
  const cola = leerCola().map(itemCola);
  if (!cola.length) return;
  sincronizando = true;
  const restantes = [];
  let enviados = 0;
  const aBlob = async (dataUrl) => (dataUrl ? (await fetch(dataUrl)).blob() : null);
  for (const item of cola) {
    try {
      await enviarPedidoCompleto(item.pedido, await aBlob(item.imagen), await aBlob(item.comprobante));
      enviados++;
    } catch (err) {
      console.warn('Pedido sin sincronizar:', err);
      restantes.push(item);
    }
  }
  guardarCola(restantes);
  sincronizando = false;
  actualizarAvisoCola();
  if (enviados) toast(`✓ Se enviaron ${enviados} pedido${enviados > 1 ? 's' : ''} guardado${enviados > 1 ? 's' : ''}.`, 'ok');
}

/* ---------- 5. Vista cliente ---------- */
const form = $('#form-pedido');

function prepararFormulario() {
  const hoy = new Date();
  const iso = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  form.fecha.min = iso;

  form.addEventListener('input', (e) => e.target.classList?.remove('invalid'));
  form.addEventListener('change', (e) => {
    e.target.closest('.chips, .catalogo')?.classList.remove('invalid');
    e.target.closest('.variante')?.classList.remove('invalid');
  });

  renderCatalogo();
  renderRellenos();
  renderDatosTransferencia();
  $$('.sena-minima').forEach((el) => (el.textContent = fmtPesoEntero.format(SENA_MINIMA)));
  form.sena.min = SENA_MINIMA;
  form.sena.defaultValue = SENA_MINIMA; // form.reset() vuelve a este valor

  // Personalizada / Tortas listas
  $$('[name=tipo]', form).forEach((r) => r.addEventListener('change', () => cambiarTipo(r.value)));

  // Rellenos: máximo 3, y elegir variante cuando corresponde
  $('#rellenos').addEventListener('change', () => {
    limitarRellenos();
    renderVariantes();
  });

  // Imagen de ejemplo
  $('#imagen').addEventListener('change', alElegirImagen);
  $('#upload-quitar').addEventListener('click', quitarImagen);

  // Seña: medio (solo presencial), copiar datos y comprobante
  $('#sena-medio').addEventListener('change', actualizarMedio);
  $('#datos-transferencia').addEventListener('click', copiarDato);
  $('#comprobante').addEventListener('change', alElegirComprobante);
  $('#comprobante-quitar').addEventListener('click', quitarComprobante);
}

/* ---------- Modo del formulario ----------
   online: lo completa el cliente (transferencia + comprobante obligatorio)
   presencial: lo carga la pastelería desde el panel (efectivo o transferencia, entra confirmado) */
let modo = 'online';

function ponerModo(nuevo) {
  const cambio = modo !== nuevo;
  modo = nuevo;
  const presencial = nuevo === 'presencial';
  $('#view-cliente').dataset.modo = nuevo;
  $('#titulo-cliente').textContent = presencial ? 'Nuevo pedido presencial' : 'Encargá tu torta';
  $('#hero-sub').textContent = presencial
    ? 'Cargá el pedido de un cliente en el local. Entra directo como confirmado.'
    : 'Completá los datos y te confirmamos por WhatsApp.';
  $('#btn-enviar .btn-label').textContent = etiquetaEnviar();
  if (cambio || !$('#pedido-ok').hidden) reiniciarFormulario();
}

const etiquetaEnviar = () => (modo === 'presencial' ? 'Cargar pedido confirmado' : 'Enviar pedido');

const medioSena = () =>
  modo === 'presencial' ? form.querySelector('[name=sena_medio]:checked')?.value || 'Efectivo' : 'Transferencia';

function actualizarMedio() {
  form.dataset.medio = medioSena();
}

function reiniciarFormulario() {
  form.reset();
  quitarImagen();
  quitarComprobante();
  cambiarTipo('Personalizada');
  limitarRellenos();
  renderVariantes();
  actualizarMedio();
  $('#pedido-ok').hidden = true;
  form.hidden = false;
}

/* ---------- Datos para transferir ---------- */
function renderDatosTransferencia() {
  const d = DATOS_TRANSFERENCIA;
  const fila = (etiqueta, valor, copiable = false) => `
    <div class="dato">
      <span class="dato-txt"><small>${esc(etiqueta)}</small><strong>${esc(valor)}</strong></span>
      ${copiable ? `<button type="button" class="btn btn-ghost btn-copiar" data-copiar="${esc(valor)}" aria-label="Copiar ${esc(etiqueta)}">Copiar</button>` : ''}
    </div>`;
  $('#datos-transferencia').innerHTML =
    '<h3>Datos para transferir</h3>' +
    fila('Alias', d.alias, true) +
    fila('CVU', d.cvu, true) +
    fila('Titular', d.titular) +
    fila('CUIT/CUIL', d.cuit) +
    fila('Banco / billetera', d.banco);
}

async function copiarDato(e) {
  const btn = e.target.closest('[data-copiar]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copiar);
    setLabel(btn, '✓ Copiado');
    setTimeout(() => setLabel(btn, 'Copiar'), 1800);
  } catch {
    toast('No se pudo copiar. Mantené apretado el dato para copiarlo a mano.', 'warn');
  }
}

/* ---------- Rellenos ---------- */
function renderRellenos() {
  $('#rellenos').innerHTML = RELLENOS.map((r, i) => `
    <label class="chip"><input type="checkbox" name="rellenos" value="${i}" /><span>${esc(r.nombre)}${r.detalle ? ` <small>(${esc(r.detalle)})</small>` : ''}</span></label>`).join('');
}

/** Muestra la elección de variante de cada relleno marcado que la tenga (sin redibujar las que ya estaban). */
function renderVariantes() {
  const cont = $('#rellenos-variantes');
  const elegidos = new Set($$('[name=rellenos]:checked', form).map((c) => Number(c.value)).filter((i) => RELLENOS[i].variantes));
  $$('.variante', cont).forEach((v) => { if (!elegidos.has(Number(v.dataset.i))) v.remove(); });
  elegidos.forEach((i) => {
    if (cont.querySelector(`.variante[data-i="${i}"]`)) return;
    const r = RELLENOS[i];
    cont.insertAdjacentHTML('beforeend', `
      <div class="variante" data-i="${i}" role="radiogroup" aria-label="${esc(r.nombre)}">
        <p>${esc(r.nombre)}: elegí una opción</p>
        <div class="chips">${r.variantes.map((v) => `<label class="chip"><input type="radio" name="variante-${i}" value="${esc(v)}" /><span>${esc(v)}</span></label>`).join('')}</div>
      </div>`);
  });
}

/** "Ganache de chocolate" + "blanco" → "Ganache de chocolate blanco" */
const rellenosElegidos = () =>
  $$('[name=rellenos]:checked', form).map((c) => {
    const r = RELLENOS[c.value];
    const variante = form.querySelector(`[name="variante-${c.value}"]:checked`)?.value;
    return variante ? `${r.nombre} ${variante}` : r.nombre;
  });

function renderCatalogo() {
  // Agrupado por bizcochuelo: "De chocolate" / "De vainilla"
  $('#catalogo').innerHTML = ['Chocolate', 'Vainilla'].map((sabor) => {
    const tortas = TORTAS_LISTAS.filter((t) => t.sabor === sabor);
    return tortas.length ? `<p class="catalogo-grupo">De ${sabor.toLowerCase()}</p>` + tortas.map(tortaCatalogo).join('') : '';
  }).join('');
}

function tortaCatalogo(t) {
  return `
    <label class="torta">
      <input type="radio" name="torta_lista" value="${esc(t.id)}" />
      <div class="torta-card">
        <div class="torta-foto">${t.imagen ? `<img src="${esc(t.imagen)}" alt="${esc(t.nombre)}" loading="lazy" />` : `<span aria-hidden="true">${t.emoji}</span>`}</div>
        <div>
          <p class="torta-nombre">${esc(t.nombre)}</p>
          <p class="torta-desc">${esc(t.descripcion)}</p>
          ${t.precio ? `<p class="torta-precio">Desde ${dinero(t.precio)}</p>` : ''}
        </div>
      </div>
      <span class="torta-check" aria-hidden="true">✓</span>
    </label>`;
}

function cambiarTipo(tipo) {
  form.dataset.tipo = tipo;
  $('#tipo-torta').dataset.active = tipo;
  $$('.invalid', form).forEach((el) => el.classList.remove('invalid'));
  $('#form-error').hidden = true;
}

function limitarRellenos() {
  const todos = $$('[name=rellenos]', form);
  const elegidos = todos.filter((c) => c.checked).length;
  todos.forEach((c) => (c.disabled = !c.checked && elegidos >= MAX_RELLENOS));
  $('#rellenos-contador').textContent =
    elegidos >= MAX_RELLENOS ? `(${MAX_RELLENOS} de ${MAX_RELLENOS} · máximo alcanzado)` : `(hasta ${MAX_RELLENOS} · elegiste ${elegidos})`;
}

/* ---------- Imagen de ejemplo ---------- */
let imagenBlob = null;
let imagenUrl = null;

/** Achica la foto (máx. 1600 px) y la convierte a JPEG para que suba rápido. */
async function comprimirImagen(file, maxLado = 1600, calidad = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('formato'));
      i.src = url;
    });
    const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // fondo blanco para PNG transparentes
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', calidad));
    if (!blob) throw new Error('formato');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function alElegirImagen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    if (!file.type.startsWith('image/')) throw new Error('formato');
    if (file.size > 25 * 1024 * 1024) throw new Error('grande');
    imagenBlob = await comprimirImagen(file);
    if (imagenUrl) URL.revokeObjectURL(imagenUrl);
    imagenUrl = URL.createObjectURL(imagenBlob);
    $('#upload-img').src = imagenUrl;
    $('#upload-zona').hidden = true;
    $('#upload-preview').hidden = false;
  } catch (err) {
    quitarImagen();
    toast(err.message === 'grande' ? 'La imagen es demasiado grande.' : 'No se pudo leer esa imagen. Probá con una foto JPG o PNG.', 'error');
  }
}

function quitarImagen() {
  imagenBlob = null;
  if (imagenUrl) URL.revokeObjectURL(imagenUrl);
  imagenUrl = null;
  $('#imagen').value = '';
  $('#upload-preview').hidden = true;
  $('#upload-zona').hidden = false;
}

/* ---------- Comprobante de la seña (foto/captura o PDF) ---------- */
let comprobanteBlob = null;
let comprobanteUrl = null;

async function alElegirComprobante(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    let blob;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (file.size > MAX_COMPROBANTE) throw new Error('grande');
      blob = new Blob([file], { type: 'application/pdf' });
    } else if (file.type.startsWith('image/')) {
      if (file.size > 25 * 1024 * 1024) throw new Error('grande');
      // Más resolución que la foto de ejemplo: se tiene que leer el número de operación
      blob = await comprimirImagen(file, 2000, 0.85);
      if (blob.size > MAX_COMPROBANTE) throw new Error('grande');
    } else {
      throw new Error('formato');
    }
    quitarComprobante();
    comprobanteBlob = blob;
    const esPdf = blob.type === 'application/pdf';
    $('#comprobante-img').hidden = esPdf;
    $('#comprobante-pdf').hidden = !esPdf;
    if (esPdf) {
      $('#comprobante-pdf').textContent = `📄 ${file.name}`;
    } else {
      comprobanteUrl = URL.createObjectURL(blob);
      $('#comprobante-img').src = comprobanteUrl;
    }
    $('#comprobante-zona').classList.remove('invalid');
    $('#comprobante-zona').hidden = true;
    $('#comprobante-preview').hidden = false;
  } catch (err) {
    quitarComprobante();
    toast(err.message === 'grande' ? 'El archivo es demasiado grande (máx. 5 MB).' : 'No se pudo leer el comprobante. Subí una foto, captura de pantalla o PDF.', 'error');
  }
}

function quitarComprobante() {
  comprobanteBlob = null;
  if (comprobanteUrl) URL.revokeObjectURL(comprobanteUrl);
  comprobanteUrl = null;
  $('#comprobante').value = '';
  $('#comprobante-img').removeAttribute('src');
  $('#comprobante-preview').hidden = true;
  $('#comprobante-zona').hidden = false;
}

const blobADataUrl = (blob) =>
  new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = mal;
    r.readAsDataURL(blob);
  });

function validarPedido() {
  const f = form;
  const errores = [];
  const marcar = (el, msg) => { el.classList.add('invalid'); errores.push(msg); };
  $$('.invalid', f).forEach((el) => el.classList.remove('invalid'));

  if (f.cliente_nombre.value.trim().length < 2) marcar(f.cliente_nombre, 'Ingresá tu nombre.');
  const tel = f.cliente_telefono.value.replace(/[^\d+]/g, '');
  if (tel.replace('+', '').length < 8) marcar(f.cliente_telefono, 'Revisá el teléfono.');
  if (!f.fecha.value) marcar(f.fecha, 'Elegí la fecha de entrega.');
  if (!f.hora.value) marcar(f.hora, 'Elegí la hora de entrega.');
  if (f.fecha.value && f.hora.value && new Date(`${f.fecha.value}T${f.hora.value}`) < new Date())
    marcar(f.fecha, 'La fecha de entrega ya pasó.');
  if (f.dataset.tipo === 'Lista') {
    if (!f.querySelector('[name=torta_lista]:checked')) marcar($('#catalogo'), 'Elegí una de las tortas listas.');
  } else {
    if (f.tematica.value.trim().length < 3) marcar(f.tematica, 'Contanos la temática o el diseño.');
    if (!f.querySelector('[name=sabor_bizcocho]:checked'))
      marcar(f.querySelector('[name=sabor_bizcocho]').closest('.chips'), 'Elegí el sabor del bizcochuelo.');
    const nRellenos = $$('[name=rellenos]:checked', f).length;
    if (nRellenos === 0) marcar($('#rellenos'), 'Elegí al menos un relleno.');
    if (nRellenos > MAX_RELLENOS) marcar($('#rellenos'), `Podés elegir hasta ${MAX_RELLENOS} rellenos.`);
    $$('.variante', f).forEach((v) => {
      if (!v.querySelector('input:checked')) marcar(v, `Elegí una opción de ${RELLENOS[v.dataset.i].nombre.toLowerCase()}.`);
    });
  }
  if (!f.peso_porciones.value) marcar(f.peso_porciones, 'Elegí el tamaño.');
  if (!(Number(f.sena.value) >= SENA_MINIMA)) marcar(f.sena, `La seña tiene que ser de al menos ${fmtPesoEntero.format(SENA_MINIMA)}.`);
  if (modo === 'online' && !comprobanteBlob) marcar($('#comprobante-zona'), 'Subí el comprobante de la transferencia.');

  return errores;
}

function leerPedido() {
  const f = form;
  const esLista = f.dataset.tipo === 'Lista';
  const torta = esLista ? TORTAS_LISTAS.find((t) => t.id === f.querySelector('[name=torta_lista]:checked').value) : null;
  const presencial = modo === 'presencial';
  const medio = medioSena();
  const id = uuid(); // generado en el cliente → permite reintentos sin duplicar
  const conComprobante = medio === 'Transferencia' && comprobanteBlob;
  return {
    id,
    tipo: esLista ? 'Lista' : 'Personalizada',
    torta_lista: torta ? torta.nombre : null,
    cliente_nombre: f.cliente_nombre.value.trim(),
    cliente_telefono: f.cliente_telefono.value.trim(),
    fecha_entrega: new Date(`${f.fecha.value}T${f.hora.value}`).toISOString(),
    tematica: esLista ? null : f.tematica.value.trim(),
    comentarios: esLista ? f.comentarios.value.trim() || null : null,
    sabor_bizcocho: torta ? torta.sabor : f.querySelector('[name=sabor_bizcocho]:checked').value,
    rellenos: torta ? torta.rellenos : rellenosElegidos(),
    peso_porciones: f.peso_porciones.value,
    precio_total: null, // lo define la pastelería, nunca el cliente
    sena: Number(f.sena.value),
    sena_medio: medio,
    origen: presencial ? 'Presencial' : 'Online',
    comprobante_path: conComprobante ? rutaComprobante(id, comprobanteBlob.type) : null,
    // Presencial: la pastelería recibe la seña en mano → entra confirmado
    estado: presencial ? 'Confirmado' : 'Pendiente',
    sena_confirmada_at: presencial ? new Date().toISOString() : null,
  };
}

function mostrarExito(texto, nota = '') {
  const presencial = modo === 'presencial';
  form.hidden = true;
  $('#pedido-ok-texto').textContent = texto;
  $('#ok-sena').textContent = nota;
  $('#ok-sena').hidden = !nota;
  $('#btn-nuevo').textContent = presencial ? 'Cargar otro pedido' : 'Hacer otro pedido';
  $('#btn-volver-panel').hidden = !presencial;
  $('#pedido-ok').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const NOTA_ONLINE = 'Goyito Pastelería revisa la transferencia y te confirma el pedido por WhatsApp.';
const NOMBRE_ARCHIVO = { imagen: 'la imagen de ejemplo', comprobante: 'el comprobante' };

/** "Ya lo recibimos…" según qué archivos llegaron */
function textoRecibido(faltan) {
  if (!faltan.length) return 'Ya recibimos tu pedido y el comprobante.';
  const varios = faltan.length > 1;
  return `Ya recibimos tu pedido, pero ${faltan.map((x) => NOMBRE_ARCHIVO[x]).join(' y ')} no se ${varios ? 'pudieron' : 'pudo'} guardar: ${varios ? 'mandalos' : 'mandalo'} por WhatsApp cuando te escribamos.`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = $('#form-error');
  errorEl.hidden = true;

  const errores = validarPedido();
  if (errores.length) {
    errorEl.textContent = errores[0];
    errorEl.hidden = false;
    form.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = $('#btn-enviar');
  btn.disabled = true;
  setLabel(btn, 'Enviando…');
  const pedido = leerPedido();
  // La foto solo aplica a tortas personalizadas
  const blob = pedido.tipo === 'Personalizada' ? imagenBlob : null;
  const comprobante = pedido.comprobante_path ? comprobanteBlob : null;

  // Honeypot: campo invisible que solo completan los bots → se simula el envío y no se manda nada
  if (form.empresa_web.value) {
    mostrarExito('Ya recibimos tu pedido y el comprobante.', NOTA_ONLINE);
    btn.disabled = false;
    setLabel(btn, etiquetaEnviar());
    return;
  }

  try {
    const faltan = await enviarPedidoCompleto(pedido, blob, comprobante);
    if (modo === 'presencial') {
      const { dia, hora } = fmtFecha(pedido.fecha_entrega);
      mostrarExito(
        `El pedido de ${pedido.cliente_nombre} para el ${dia} a las ${hora} h quedó cargado y confirmado.`,
        `Seña: ${dinero(pedido.sena)} · ${pedido.sena_medio}` + (faltan.length ? ` · ⚠️ No se pudo guardar ${faltan.map((x) => NOMBRE_ARCHIVO[x]).join(' ni ')}.` : '')
      );
      toast('✓ Pedido cargado', 'ok');
    } else {
      mostrarExito(textoRecibido(faltan), NOTA_ONLINE);
      toast('✓ Pedido enviado', 'ok');
    }
  } catch (err) {
    if (esErrorDeRed(err) && modo === 'presencial') {
      // Sin respaldo offline: el pedido presencial necesita la sesión del admin al enviarse
      errorEl.textContent = 'Sin conexión: el pedido no se cargó. Revisá internet e intentá de nuevo.';
      errorEl.hidden = false;
    } else if (esErrorDeRed(err)) {
      // Respaldo automático: no se pierde el pedido
      const aDataUrl = async (b) => { try { return b ? await blobADataUrl(b) : null; } catch { return null; } };
      const guardado = encolar(pedido, await aDataUrl(blob), await aDataUrl(comprobante));
      if (guardado) {
        actualizarAvisoCola();
        mostrarExito('No hay conexión en este momento. Guardamos tu pedido en este dispositivo y se enviará solo apenas vuelva internet. No cierres ni borres los datos del navegador.', NOTA_ONLINE);
        toast(guardado === 'parcial' ? 'Sin conexión: pedido guardado (sin algún archivo, por espacio: mandalo por WhatsApp)' : 'Sin conexión: pedido guardado en el dispositivo', 'warn', 6000);
      } else {
        errorEl.textContent = 'No hay conexión y no se pudo guardar el pedido en el dispositivo. Intentá de nuevo en unos minutos.';
        errorEl.hidden = false;
      }
    } else {
      console.error('Error al insertar pedido:', err);
      errorEl.textContent = mensajeLimite(err) || 'No pudimos registrar el pedido. Revisá los datos e intentá otra vez.';
      errorEl.hidden = false;
      toast('Error al enviar el pedido', 'error');
    }
  } finally {
    btn.disabled = false;
    setLabel(btn, etiquetaEnviar());
  }
});

$('#btn-nuevo').addEventListener('click', reiniciarFormulario);

/* ---------- 6. Autenticación del administrador ---------- */
let sesion = null;

async function esAdministrador(userId) {
  try {
    const { data, error } = await sb.from('administradores').select('user_id').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return !!data;
  } catch (err) {
    console.error('Error verificando administrador:', err);
    return false;
  }
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const errEl = $('#login-error');
  errEl.hidden = true;

  if (!sb) {
    errEl.textContent = configurado ? 'Sin conexión con el servidor. Revisá internet.' : 'Falta configurar Supabase en app.js.';
    errEl.hidden = false;
    return;
  }

  const btn = $('#btn-login');
  btn.disabled = true;
  setLabel(btn, 'Ingresando…');
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: f.email.value.trim(),
      password: f.password.value,
    });
    if (error) throw error;
    if (!(await esAdministrador(data.user.id))) {
      await sb.auth.signOut();
      throw new Error('no-admin');
    }
    f.reset();
    // onAuthStateChange se encarga del resto
  } catch (err) {
    errEl.textContent =
      err.message === 'no-admin'
        ? 'Esta cuenta no tiene permisos de administrador.'
        : esErrorDeRed(err)
        ? 'Sin conexión. Revisá internet e intentá de nuevo.'
        : 'Correo o contraseña incorrectos.';
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
    setLabel(btn, 'Ingresar');
  }
});

$('#btn-logout').addEventListener('click', async () => {
  try {
    await sb?.auth.signOut();
  } catch (err) {
    console.error('Error al cerrar sesión:', err);
  }
  sesion = null;
  detenerRealtime();
  pedidos = [];
  route();
});

/* ---------- 7. Panel admin: datos, filtros y tiempo real ---------- */
let pedidos = [];
let canal = null;
let soloUrgentes = false;
let animarEntrada = false;   // cascada solo en la primera carga, no al filtrar
const recienLlegados = new Set(); // ids que llegaron en tiempo real

async function cargarPedidos() {
  const lista = $('#lista-pedidos');
  const errEl = $('#admin-error');
  errEl.hidden = true;
  if (!pedidos.length) lista.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

  try {
    // Solo lo que sirve en el panel: todo lo no entregado + lo entregado en los últimos 60 días.
    // Así el historial viejo nunca deja afuera a los pedidos futuros.
    const desde = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await sb
      .from(TABLA)
      .select('*')
      .or(`estado.neq.Entregado,fecha_entrega.gte.${desde}`)
      .order('fecha_entrega', { ascending: true })
      .limit(1000);
    if (error) throw error;
    animarEntrada = pedidos.length === 0;
    pedidos = data || [];
    render();
  } catch (err) {
    console.error('Error cargando pedidos:', err);
    errEl.textContent = esErrorDeRed(err)
      ? 'Sin conexión: no se pudieron cargar los pedidos. Se mostrarán al volver internet.'
      : 'No se pudieron cargar los pedidos (' + (err.message || 'error desconocido') + ').';
    errEl.hidden = false;
    if (!pedidos.length) lista.innerHTML = '';
  }
}

function iniciarRealtime() {
  if (!sb || canal) return;
  try {
    canal = sb
      .channel('pedidos-tortas')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLA }, (payload) => {
        if (payload.eventType === 'INSERT') {
          if (pedidos.some((p) => p.id === payload.new.id)) return;
          pedidos.push(payload.new);
          recienLlegados.add(payload.new.id);
          toast(`🎂 Nuevo pedido de ${payload.new.cliente_nombre}`, 'ok', 6000);
        } else if (payload.eventType === 'UPDATE') {
          pedidos = pedidos.map((p) => (p.id === payload.new.id ? payload.new : p));
        } else if (payload.eventType === 'DELETE') {
          pedidos = pedidos.filter((p) => p.id !== payload.old.id);
        }
        pedidos.sort((a, b) => new Date(a.fecha_entrega) - new Date(b.fecha_entrega));
        render();
      })
      .subscribe((status) => {
        const on = status === 'SUBSCRIBED';
        $('#live-dot').classList.toggle('on', on);
        $('#live-text').textContent = on ? 'En vivo: los pedidos nuevos aparecen solos' : 'Reconectando…';
      });
  } catch (err) {
    console.error('Error en tiempo real:', err);
    $('#live-text').textContent = 'Tiempo real no disponible (usá Actualizar)';
  }
}

function detenerRealtime() {
  try {
    if (canal) sb.removeChannel(canal);
  } catch (err) {
    console.error(err);
  }
  canal = null;
}

function rangoFecha(p, modo) {
  const t = new Date(p.fecha_entrega);
  const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
  const finHoy = new Date(inicioHoy); finHoy.setDate(finHoy.getDate() + 1);
  const en7 = new Date(inicioHoy); en7.setDate(en7.getDate() + 8);
  if (modo === 'hoy') return t >= inicioHoy && t < finHoy;
  if (modo === 'semana') return t >= inicioHoy && t < en7;
  if (modo === 'proximos') return t >= inicioHoy || p.estado !== 'Entregado'; // incluye atrasados sin entregar
  return true;
}

const esUrgente = (p) =>
  p.estado !== 'Entregado' && new Date(p.fecha_entrega) - Date.now() < 24 * 3600 * 1000;

function render() {
  const texto = $('#f-buscar').value.trim().toLowerCase();
  const estado = $('#f-estado').value;
  const modoFecha = $('#f-fecha').value;

  const porFecha = pedidos.filter((p) => rangoFecha(p, modoFecha));

  // Contadores
  $('#n-pend').textContent = porFecha.filter((p) => p.estado === 'Pendiente').length;
  $('#n-conf').textContent = porFecha.filter((p) => p.estado === 'Confirmado').length;
  $('#n-proc').textContent = porFecha.filter((p) => p.estado === 'En Proceso').length;
  $('#n-entr').textContent = porFecha.filter((p) => p.estado === 'Entregado').length;
  $('#n-urg').textContent = pedidos.filter(esUrgente).length;

  $$('.stat').forEach((s) =>
    s.classList.toggle('selected', soloUrgentes ? s.dataset.filtro === 'urgentes' : !!estado && s.dataset.estado === estado)
  );

  const visibles = (soloUrgentes ? pedidos.filter(esUrgente) : porFecha).filter((p) => {
    if (estado && p.estado !== estado) return false;
    if (!texto) return true;
    return [p.cliente_nombre, p.cliente_telefono, p.tematica, p.torta_lista, p.comentarios].some((v) => String(v || '').toLowerCase().includes(texto));
  });

  $('#lista-vacia').hidden = visibles.length > 0;
  const lista = $('#lista-pedidos');
  lista.classList.toggle('entrada', animarEntrada);
  animarEntrada = false;
  lista.innerHTML = visibles.map(tarjeta).join('');
  recienLlegados.clear();
  cargarMiniaturas();
}

/* ---------- Fotos de ejemplo y comprobantes en el panel (URLs firmadas, los buckets son privados) ---------- */
const urlsFirmadas = new Map(); // ruta → { url, vence }
const archivosFaltantes = new Set(); // rutas sin archivo en el bucket

async function firmarUrls(bucket, rutas) {
  const ahora = Date.now();
  const faltan = [...new Set(rutas)].filter((r) => !(urlsFirmadas.get(r)?.vence > ahora));
  if (!faltan.length) return;
  try {
    const { data, error } = await sb.storage.from(bucket).createSignedUrls(faltan, 3600);
    if (error) throw error;
    (data || []).forEach((d) => {
      if (d.signedUrl) {
        urlsFirmadas.set(d.path, { url: d.signedUrl, vence: ahora + 55 * 60 * 1000 });
        archivosFaltantes.delete(d.path);
      } else if (d.path) archivosFaltantes.add(d.path); // el pedido entró pero el archivo no llegó a subirse
    });
  } catch (err) {
    console.error('No se pudieron cargar los archivos:', err);
  }
}

async function cargarMiniaturas() {
  const botones = $$('.pedido-img[data-ruta]');
  const comprobantes = $$('[data-comprobante]');
  if (!sb || (!botones.length && !comprobantes.length)) return;
  await Promise.all([
    botones.length && firmarUrls(BUCKET, botones.map((b) => b.dataset.ruta)),
    comprobantes.length && firmarUrls(BUCKET_COMPROBANTES, comprobantes.map((a) => a.dataset.comprobante)),
  ]);
  botones.forEach((b) => {
    if (archivosFaltantes.has(b.dataset.ruta)) b.hidden = true;
    const url = urlsFirmadas.get(b.dataset.ruta)?.url;
    const img = b.querySelector('img');
    if (url && img && !img.src) {
      img.onload = () => img.classList.add('cargada');
      img.src = url;
    }
  });
  comprobantes.forEach((a) => {
    const ruta = a.dataset.comprobante;
    if (archivosFaltantes.has(ruta)) {
      a.outerHTML = '<p class="aviso-comprobante">⚠️ El comprobante no llegó: pedíselo al cliente por WhatsApp.</p>';
      return;
    }
    const url = urlsFirmadas.get(ruta)?.url;
    if (url) {
      a.href = url;
      a.removeAttribute('aria-disabled');
    }
  });
}

async function quitarArchivoDeStorage(bucket, ruta) {
  if (!ruta) return;
  try {
    const { error } = await sb.storage.from(bucket).remove([ruta]);
    if (error) throw error;
    urlsFirmadas.delete(ruta);
  } catch (err) {
    console.warn('No se pudo borrar el archivo (no afecta al pedido):', err);
  }
}

/** Arma el número para wa.me: los números locales de Argentina necesitan el prefijo 549. */
function numeroWhatsApp(telefono) {
  const n = String(telefono || '').replace(/\D/g, '').replace(/^0/, '');
  return n.length <= 10 ? '549' + n : n;
}

function tarjeta(p, i = 0) {
  const { dia, hora } = fmtFecha(p.fecha_entrega);
  const conPrecio = p.precio_total != null;
  const saldo = conPrecio ? Math.max(Number(p.precio_total) - (Number(p.sena) || 0), 0) : null;
  const atrasado = p.estado !== 'Entregado' && new Date(p.fecha_entrega) < new Date();
  const urgente = esUrgente(p);
  const claseEstado = 'est-' + String(p.estado).replace(/\s/g, '');
  const tel = numeroWhatsApp(p.cliente_telefono);
  const rellenos = Array.isArray(p.rellenos) ? p.rellenos.join(', ') : p.rellenos;

  return `
  <article class="card pedido ${claseEstado} ${urgente ? 'urgente' : ''} ${recienLlegados.has(p.id) ? 'nuevo' : ''}" data-id="${esc(p.id)}" style="--i:${Math.min(i, 8)}">
    <div class="pedido-top">
      <div>
        <p class="pedido-cliente">${esc(p.cliente_nombre)}</p>
        <a class="pedido-tel" href="https://wa.me/${esc(tel)}" target="_blank" rel="noopener">💬 ${esc(p.cliente_telefono)}</a>
      </div>
      <div class="pedido-fecha">
        ${esc(dia)}<small>${esc(hora)} h</small>
        ${atrasado ? '<span class="tag-urgente">ATRASADO</span>' : urgente ? '<span class="tag-urgente">PRÓXIMO</span>' : ''}
      </div>
    </div>
    <div class="pedido-tags">
      ${p.tipo === 'Lista' ? `<span class="tag-tipo">🍰 Torta lista · ${esc(p.torta_lista)}</span>` : `<span class="tag-tipo">🎨 Personalizada</span>`}
      ${p.origen === 'Presencial' ? '<span class="tag-tipo tag-presencial">🏪 Presencial</span>' : ''}
    </div>
    ${p.imagen_path ? `<button type="button" class="pedido-img" data-ruta="${esc(p.imagen_path)}" aria-label="Ver imagen de ejemplo en grande"><img alt="Imagen de ejemplo de ${esc(p.cliente_nombre)}" /></button>` : ''}
    ${p.tematica || p.comentarios ? `<p class="pedido-tema">${esc(p.tematica || p.comentarios)}</p>` : ''}
    <dl class="pedido-detalles">
      <dt>Bizcochuelo</dt><dd>${esc(p.sabor_bizcocho)}</dd>
      <dt>Tamaño</dt><dd>${esc(p.peso_porciones)}</dd>
      <dt>Rellenos</dt><dd>${esc(rellenos)}</dd>
    </dl>
    <div class="pedido-pago">
      <span class="pill">${conPrecio ? 'Total ' + dinero(p.precio_total) : 'Precio a definir'}</span>
      <span class="pill">Seña ${dinero(p.sena)} · ${esc(p.sena_medio || '—')}</span>
      ${conPrecio ? `<span class="pill ${saldo ? 'pill-saldo' : 'pill-ok'}">${saldo ? 'Saldo ' + dinero(saldo) : 'Pagado'}</span>` : ''}
      ${p.sena_confirmada_at ? `<span class="pill pill-ok">✓ Seña recibida el ${esc(fmtFecha(p.sena_confirmada_at).dia)}</span>` : ''}
    </div>
    ${p.comprobante_path ? `<a class="btn btn-sm btn-ghost btn-comprobante" data-comprobante="${esc(p.comprobante_path)}" target="_blank" rel="noopener" aria-disabled="true">🧾 Ver comprobante</a>` : ''}
    ${p.estado === 'Pendiente' ? `
    <div class="confirmar-sena">
      <p>${p.comprobante_path
        ? '<strong>Revisá en tu Mercado Pago que la transferencia llegó</strong> (el comprobante solo no alcanza: se puede falsificar). Después confirmá el pedido.'
        : '<strong>Esperando la seña.</strong> Cuando la recibas, anotá el monto y confirmá el pedido.'}</p>
      <div class="confirmar-fila">
        <label class="field">
          <span>Seña recibida ($)</span>
          <input type="number" inputmode="decimal" min="${SENA_MINIMA}" step="0.01" data-campo="sena-recibida" value="${Number(p.sena) > 0 ? esc(p.sena) : ''}" />
        </label>
        <button type="button" class="btn btn-sm btn-primary" data-accion="confirmar">✓ Confirmar pedido</button>
      </div>
    </div>` : ''}
    ${p.estado === 'Confirmado' ? `<a class="btn btn-sm btn-ghost btn-wa" href="https://wa.me/${esc(tel)}?text=${encodeURIComponent(`Hola ${p.cliente_nombre}, recibimos tu seña y tu pedido para el ${dia} a las ${hora} h quedó confirmado. ¡Gracias! Goyito Pastelería`)}" target="_blank" rel="noopener">💬 Avisar al cliente por WhatsApp</a>` : ''}
    <div class="pedido-acciones">
      <select class="sel-estado sel-${claseEstado.slice(4)}" data-accion="estado" aria-label="Estado del pedido">
        ${ESTADOS.map((e) => `<option ${e === p.estado ? 'selected' : ''}>${e}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-danger" data-accion="borrar" aria-label="Eliminar pedido">Eliminar</button>
    </div>
  </article>`;
}

async function cambiarEstado(id, nuevo, selectEl) {
  const anterior = pedidos.find((p) => p.id === id)?.estado;
  selectEl.disabled = true;
  try {
    const { error } = await sb.from(TABLA).update({ estado: nuevo }).eq('id', id);
    if (error) throw error;
    pedidos = pedidos.map((p) => (p.id === id ? { ...p, estado: nuevo } : p));
    render();
    toast(`Estado: ${nuevo}`, 'ok', 2500);
  } catch (err) {
    console.error('Error al actualizar estado:', err);
    selectEl.value = anterior;
    toast(esErrorDeRed(err) ? 'Sin conexión: no se cambió el estado.' : 'No se pudo cambiar el estado.', 'error');
  } finally {
    selectEl.disabled = false;
  }
}

/** El dueño confirma que recibió la seña: guarda el monto y pasa el pedido a "Confirmado". */
async function confirmarSena(id, btn) {
  const card = btn.closest('.pedido');
  const input = card.querySelector('[data-campo=sena-recibida]');
  const monto = Number(input.value);
  if (!(monto >= SENA_MINIMA)) {
    input.classList.add('invalid');
    input.focus();
    toast(`Anotá el monto de la seña recibida (mínimo ${fmtPesoEntero.format(SENA_MINIMA)}).`, 'warn', 3000);
    return;
  }
  const p = pedidos.find((x) => x.id === id);
  if (p?.precio_total != null && monto > Number(p.precio_total)) {
    input.classList.add('invalid');
    toast('La seña no puede superar el precio total.', 'warn', 3000);
    return;
  }
  btn.disabled = true;
  const cambios = { estado: 'Confirmado', sena: monto, sena_confirmada_at: new Date().toISOString() };
  try {
    const { error } = await sb.from(TABLA).update(cambios).eq('id', id);
    if (error) throw error;
    pedidos = pedidos.map((x) => (x.id === id ? { ...x, ...cambios } : x));
    render();
    toast(`✓ Pedido de ${p?.cliente_nombre || 'cliente'} confirmado`, 'ok');
  } catch (err) {
    console.error('Error al confirmar la seña:', err);
    btn.disabled = false;
    toast(esErrorDeRed(err) ? 'Sin conexión: el pedido no se confirmó.' : 'No se pudo confirmar el pedido.', 'error');
  }
}

async function borrarPedido(id) {
  const p = pedidos.find((x) => x.id === id);
  if (!confirm(`¿Eliminar definitivamente el pedido de ${p?.cliente_nombre || 'este cliente'}?`)) return;
  try {
    const { error } = await sb.from(TABLA).delete().eq('id', id);
    if (error) throw error;
    // Salida corta antes de quitarlo de la lista (evita un salto brusco)
    const card = $(`.pedido[data-id="${CSS.escape(id)}"]`);
    if (card && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      card.classList.add('saliendo');
      await new Promise((r) => setTimeout(r, 180));
    }
    pedidos = pedidos.filter((x) => x.id !== id);
    render();
    toast('Pedido eliminado', 'ok', 2500);
    quitarArchivoDeStorage(BUCKET, p?.imagen_path);
    quitarArchivoDeStorage(BUCKET_COMPROBANTES, p?.comprobante_path);
  } catch (err) {
    console.error('Error al eliminar:', err);
    toast(esErrorDeRed(err) ? 'Sin conexión: no se eliminó.' : 'No se pudo eliminar el pedido.', 'error');
  }
}

// Delegación de eventos en la lista
$('#lista-pedidos').addEventListener('input', (e) => e.target.classList?.remove('invalid'));
$('#lista-pedidos').addEventListener('change', (e) => {
  if (e.target.dataset.accion === 'estado') {
    cambiarEstado(e.target.closest('.pedido').dataset.id, e.target.value, e.target);
  }
});
$('#lista-pedidos').addEventListener('click', (e) => {
  const foto = e.target.closest('.pedido-img');
  if (foto) {
    const url = urlsFirmadas.get(foto.dataset.ruta)?.url;
    if (url) window.open(url, '_blank', 'noopener');
    return;
  }
  const conf = e.target.closest('[data-accion=confirmar]');
  if (conf) {
    confirmarSena(conf.closest('.pedido').dataset.id, conf);
    return;
  }
  const btn = e.target.closest('[data-accion=borrar]');
  if (btn) borrarPedido(btn.closest('.pedido').dataset.id);
});

// Filtros
$('#f-buscar').addEventListener('input', render);
$('#f-estado').addEventListener('change', () => { soloUrgentes = false; render(); });
$('#f-fecha').addEventListener('change', () => { soloUrgentes = false; render(); });
$$('.stat').forEach((s) =>
  s.addEventListener('click', () => {
    if (s.dataset.filtro === 'urgentes') {
      soloUrgentes = !soloUrgentes;
      $('#f-estado').value = '';
    } else {
      soloUrgentes = false;
      $('#f-estado').value = $('#f-estado').value === s.dataset.estado ? '' : s.dataset.estado;
    }
    render();
  })
);
$('#btn-refrescar').addEventListener('click', cargarPedidos);

/* ---------- 8. Navegación entre vistas (hash) ---------- */
function mostrar(id) {
  ['view-cliente', 'view-login', 'view-admin'].forEach((v) => ($('#' + v).hidden = v !== id));
  const nav = id === 'view-cliente' && modo === 'online' ? 'cliente' : 'admin';
  $('.topnav').dataset.active = nav;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
}

function route() {
  if (location.hash.startsWith('#/admin')) {
    if (sesion && location.hash.startsWith('#/admin/nuevo')) {
      // El admin carga un pedido presencial con el mismo formulario
      ponerModo('presencial');
      mostrar('view-cliente');
      window.scrollTo({ top: 0 });
    } else if (sesion) {
      mostrar('view-admin');
      cargarPedidos();
      iniciarRealtime();
    } else {
      mostrar('view-login');
    }
  } else {
    ponerModo('online');
    mostrar('view-cliente');
  }
}
window.addEventListener('hashchange', route);

/* ---------- 9. Conexión y arranque ---------- */
function actualizarBannerConexion() {
  $('#offline-banner').hidden = navigator.onLine;
}
window.addEventListener('online', () => {
  actualizarBannerConexion();
  sincronizarCola();
  if (sesion && !$('#view-admin').hidden) cargarPedidos();
});
window.addEventListener('offline', actualizarBannerConexion);

async function iniciar() {
  prepararFormulario();
  actualizarBannerConexion();
  actualizarAvisoCola();

  if (!configurado) {
    toast('⚠️ Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en app.js', 'warn', 8000);
  }

  if (sb) {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session && (await esAdministrador(data.session.user.id))) sesion = data.session;
    } catch (err) {
      console.error('Error recuperando sesión:', err);
    }

    sb.auth.onAuthStateChange(async (evento, nuevaSesion) => {
      if (evento === 'SIGNED_IN' && nuevaSesion) {
        // diferido para no bloquear el callback de Supabase
        setTimeout(async () => {
          if (await esAdministrador(nuevaSesion.user.id)) {
            sesion = nuevaSesion;
            route();
          }
        }, 0);
      } else if (evento === 'SIGNED_OUT') {
        sesion = null;
        detenerRealtime();
        route();
      } else if (evento === 'TOKEN_REFRESHED' && nuevaSesion && sesion) {
        sesion = nuevaSesion;
      }
    });
  }

  route();
  sincronizarCola();
}

// Service Worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('SW no registrado:', err));
  });
}

iniciar();

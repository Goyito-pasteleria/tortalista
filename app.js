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
const COLA_KEY = 'tortalista_pedidos_pendientes'; // respaldo local
// Pendiente = esperando la seña · Confirmado = la pastelería recibió la seña
const ESTADOS = ['Pendiente', 'Confirmado', 'En Proceso', 'Entregado'];
const MAX_RELLENOS = 3;

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
/** Normaliza un elemento de la cola: { pedido, imagen (dataURL | null) } */
const itemCola = (x) => (x && x.pedido ? x : { pedido: x, imagen: null });

/** Guarda el pedido (y su foto comprimida) en el dispositivo. Devuelve 'ok', 'sin-imagen' o false. */
function encolar(pedido, imagenDataUrl = null) {
  const cola = leerCola().map(itemCola);
  if (cola.some((x) => x.pedido.id === pedido.id)) return 'ok';
  cola.push({ pedido, imagen: imagenDataUrl });
  if (guardarCola(cola)) return 'ok';
  // Si la foto no entra en el almacenamiento, se guarda el pedido sin ella
  if (imagenDataUrl) {
    cola[cola.length - 1].imagen = null;
    if (guardarCola(cola)) return 'sin-imagen';
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

/** Sube la foto de ejemplo al bucket privado. Devuelve la ruta guardada. */
async function subirImagen(pedidoId, blob) {
  if (!sb) throw new Error('network: Supabase no disponible');
  const ruta = `${pedidoId}/referencia.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
  // "Ya existe" → se había subido en un intento previo
  if (error && !/exist|duplicate/i.test(error.message || '') && String(error.statusCode) !== '409') throw error;
  return ruta;
}

/** Envía un pedido completo: primero la foto (si hay) y después los datos. */
async function enviarPedidoCompleto(pedido, blob) {
  if (blob) pedido.imagen_path = await subirImagen(pedido.id, blob);
  await insertarPedido(pedido);
}

let sincronizando = false;
async function sincronizarCola() {
  if (sincronizando || !navigator.onLine || !sb) return;
  const cola = leerCola().map(itemCola);
  if (!cola.length) return;
  sincronizando = true;
  const restantes = [];
  let enviados = 0;
  for (const item of cola) {
    try {
      const blob = item.imagen ? await (await fetch(item.imagen)).blob() : null;
      await enviarPedidoCompleto(item.pedido, blob);
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
  form.addEventListener('change', (e) => e.target.closest('.chips, .catalogo')?.classList.remove('invalid'));

  renderCatalogo();

  // Personalizada / Tortas listas
  $$('[name=tipo]', form).forEach((r) => r.addEventListener('change', () => cambiarTipo(r.value)));

  // Rellenos: máximo 3
  $('#rellenos').addEventListener('change', limitarRellenos);

  // Imagen de ejemplo
  $('#imagen').addEventListener('change', alElegirImagen);
  $('#upload-quitar').addEventListener('click', quitarImagen);
}

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
  }
  if (!f.peso_porciones.value) marcar(f.peso_porciones, 'Elegí el tamaño.');
  if (Number(f.sena.value || 0) < 0) marcar(f.sena, 'La seña no puede ser negativa.');

  return errores;
}

function leerPedido() {
  const f = form;
  const esLista = f.dataset.tipo === 'Lista';
  const torta = esLista ? TORTAS_LISTAS.find((t) => t.id === f.querySelector('[name=torta_lista]:checked').value) : null;
  return {
    id: uuid(), // generado en el cliente → permite reintentos sin duplicar
    tipo: esLista ? 'Lista' : 'Personalizada',
    torta_lista: torta ? torta.nombre : null,
    cliente_nombre: f.cliente_nombre.value.trim(),
    cliente_telefono: f.cliente_telefono.value.trim(),
    fecha_entrega: new Date(`${f.fecha.value}T${f.hora.value}`).toISOString(),
    tematica: esLista ? null : f.tematica.value.trim(),
    comentarios: esLista ? f.comentarios.value.trim() || null : null,
    sabor_bizcocho: torta ? torta.sabor : f.querySelector('[name=sabor_bizcocho]:checked').value,
    rellenos: torta ? torta.rellenos : $$('[name=rellenos]:checked', f).map((c) => c.value),
    peso_porciones: f.peso_porciones.value,
    precio_total: null, // lo define la pastelería, nunca el cliente
    sena: Number(f.sena.value || 0),
    sena_medio: f.querySelector('[name=sena_medio]:checked')?.value || 'Efectivo',
    estado: 'Pendiente',
  };
}

function mostrarExito(texto) {
  form.hidden = true;
  $('#pedido-ok-texto').textContent = texto;
  $('#pedido-ok').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

  try {
    await enviarPedidoCompleto(pedido, blob);
    mostrarExito('Ya lo recibimos. Te vamos a escribir por WhatsApp para confirmarlo.');
    toast('✓ Pedido enviado', 'ok');
  } catch (err) {
    if (esErrorDeRed(err)) {
      // Respaldo automático: no se pierde el pedido
      delete pedido.imagen_path; // se vuelve a subir al sincronizar
      let dataUrl = null;
      try { if (blob) dataUrl = await blobADataUrl(blob); } catch { dataUrl = null; }
      const guardado = encolar(pedido, dataUrl);
      if (guardado) {
        actualizarAvisoCola();
        mostrarExito('No hay conexión en este momento. Guardamos tu pedido en este dispositivo y se enviará solo apenas vuelva internet. No cierres ni borres los datos del navegador.');
        toast(guardado === 'sin-imagen' ? 'Sin conexión: pedido guardado (sin la imagen, por espacio)' : 'Sin conexión: pedido guardado en el dispositivo', 'warn', 6000);
      } else {
        errorEl.textContent = 'No hay conexión y no se pudo guardar el pedido en el dispositivo. Intentá de nuevo en unos minutos.';
        errorEl.hidden = false;
      }
    } else {
      console.error('Error al insertar pedido:', err);
      errorEl.textContent = 'No pudimos registrar el pedido. Revisá los datos e intentá otra vez.';
      errorEl.hidden = false;
      toast('Error al enviar el pedido', 'error');
    }
  } finally {
    btn.disabled = false;
    setLabel(btn, 'Enviar pedido');
  }
});

$('#btn-nuevo').addEventListener('click', () => {
  form.reset();
  quitarImagen();
  cambiarTipo('Personalizada');
  limitarRellenos();
  $('#pedido-ok').hidden = true;
  form.hidden = false;
});

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

/* ---------- Fotos de ejemplo en el panel (URLs firmadas, el bucket es privado) ---------- */
const urlsFirmadas = new Map(); // ruta → { url, vence }

async function cargarMiniaturas() {
  const botones = $$('.pedido-img[data-ruta]');
  if (!botones.length || !sb) return;
  const ahora = Date.now();
  const faltan = [...new Set(botones.map((b) => b.dataset.ruta))].filter((r) => !(urlsFirmadas.get(r)?.vence > ahora));
  if (faltan.length) {
    try {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(faltan, 3600);
      if (error) throw error;
      (data || []).forEach((d) => {
        if (d.signedUrl) urlsFirmadas.set(d.path, { url: d.signedUrl, vence: ahora + 55 * 60 * 1000 });
      });
    } catch (err) {
      console.error('No se pudieron cargar las imágenes:', err);
    }
  }
  botones.forEach((b) => {
    const url = urlsFirmadas.get(b.dataset.ruta)?.url;
    const img = b.querySelector('img');
    if (url && img && !img.src) {
      img.onload = () => img.classList.add('cargada');
      img.src = url;
    }
  });
}

async function quitarImagenDeStorage(ruta) {
  if (!ruta) return;
  try {
    const { error } = await sb.storage.from(BUCKET).remove([ruta]);
    if (error) throw error;
    urlsFirmadas.delete(ruta);
  } catch (err) {
    console.warn('No se pudo borrar la imagen (no afecta al pedido):', err);
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
    ${p.tipo === 'Lista' ? `<span class="tag-tipo">🍰 Torta lista · ${esc(p.torta_lista)}</span>` : `<span class="tag-tipo">🎨 Personalizada</span>`}
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
    ${p.estado === 'Pendiente' ? `
    <div class="confirmar-sena">
      <p><strong>Esperando la seña.</strong> Cuando la recibas, anotá el monto y confirmá el pedido.</p>
      <div class="confirmar-fila">
        <label class="field">
          <span>Seña recibida ($)</span>
          <input type="number" inputmode="decimal" min="1" step="0.01" data-campo="sena-recibida" value="${Number(p.sena) > 0 ? esc(p.sena) : ''}" />
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
  if (!(monto > 0)) {
    input.classList.add('invalid');
    input.focus();
    toast('Anotá el monto de la seña recibida.', 'warn', 3000);
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
    quitarImagenDeStorage(p?.imagen_path);
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
  const nav = id === 'view-cliente' ? 'cliente' : 'admin';
  $('.topnav').dataset.active = nav;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
}

function route() {
  if (location.hash.startsWith('#/admin')) {
    if (sesion) {
      mostrar('view-admin');
      cargarPedidos();
      iniciarRealtime();
    } else {
      mostrar('view-login');
    }
  } else {
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

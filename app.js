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
const COLA_KEY = 'tortalista_pedidos_pendientes'; // respaldo local
const ESTADOS = ['Pendiente', 'En Proceso', 'Entregado'];

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
function encolar(pedido) {
  const cola = leerCola();
  if (!cola.some((p) => p.id === pedido.id)) cola.push(pedido);
  return guardarCola(cola);
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
  const { error } = await sb.from(TABLA).insert(pedido);
  // 23505 = clave duplicada → ya se había enviado en un intento previo.
  if (error && error.code !== '23505') throw error;
}

let sincronizando = false;
async function sincronizarCola() {
  if (sincronizando || !navigator.onLine || !sb) return;
  const cola = leerCola();
  if (!cola.length) return;
  sincronizando = true;
  const restantes = [];
  let enviados = 0;
  for (const pedido of cola) {
    try {
      await insertarPedido(pedido);
      enviados++;
    } catch (err) {
      console.warn('Pedido sin sincronizar:', err);
      restantes.push(pedido);
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

  const calcularSaldo = () => {
    const saldo = (Number(form.precio_total.value) || 0) - (Number(form.sena.value) || 0);
    $('#saldo').textContent = dinero(Math.max(saldo, 0));
  };
  form.precio_total.addEventListener('input', calcularSaldo);
  form.sena.addEventListener('input', calcularSaldo);
  form.addEventListener('input', (e) => e.target.classList?.remove('invalid'));
  form.addEventListener('change', (e) => e.target.closest('.chips')?.classList.remove('invalid'));
}

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
  if (f.tematica.value.trim().length < 3) marcar(f.tematica, 'Contanos la temática o el diseño.');
  if (!f.querySelector('[name=sabor_bizcocho]:checked'))
    marcar(f.querySelector('[name=sabor_bizcocho]').closest('.chips'), 'Elegí el sabor del bizcochuelo.');
  if (!f.querySelector('[name=rellenos]:checked')) marcar($('#rellenos'), 'Elegí al menos un relleno.');
  if (!f.peso_porciones.value) marcar(f.peso_porciones, 'Elegí el tamaño.');
  const precio = Number(f.precio_total.value);
  const sena = Number(f.sena.value || 0);
  if (!(precio > 0)) marcar(f.precio_total, 'Ingresá el precio total.');
  if (sena < 0 || sena > precio) marcar(f.sena, 'La seña no puede superar el precio total.');

  return errores;
}

function leerPedido() {
  const f = form;
  return {
    id: uuid(), // generado en el cliente → permite reintentos sin duplicar
    cliente_nombre: f.cliente_nombre.value.trim(),
    cliente_telefono: f.cliente_telefono.value.trim(),
    fecha_entrega: new Date(`${f.fecha.value}T${f.hora.value}`).toISOString(),
    tematica: f.tematica.value.trim(),
    sabor_bizcocho: f.querySelector('[name=sabor_bizcocho]:checked').value,
    rellenos: $$('[name=rellenos]:checked', f).map((c) => c.value),
    peso_porciones: f.peso_porciones.value,
    precio_total: Number(f.precio_total.value),
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

  try {
    await insertarPedido(pedido);
    mostrarExito('Ya lo recibimos. Te vamos a escribir por WhatsApp para confirmarlo.');
    toast('✓ Pedido enviado', 'ok');
  } catch (err) {
    if (esErrorDeRed(err)) {
      // Respaldo automático: no se pierde el pedido
      if (encolar(pedido)) {
        actualizarAvisoCola();
        mostrarExito('No hay conexión en este momento. Guardamos tu pedido en este dispositivo y se enviará solo apenas vuelva internet. No cierres ni borres los datos del navegador.');
        toast('Sin conexión: pedido guardado en el dispositivo', 'warn', 6000);
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
  $('#saldo').textContent = dinero(0);
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
    const { data, error } = await sb
      .from(TABLA)
      .select('*')
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
  $('#n-proc').textContent = porFecha.filter((p) => p.estado === 'En Proceso').length;
  $('#n-entr').textContent = porFecha.filter((p) => p.estado === 'Entregado').length;
  $('#n-urg').textContent = pedidos.filter(esUrgente).length;

  $$('.stat').forEach((s) =>
    s.classList.toggle('selected', soloUrgentes ? s.dataset.filtro === 'urgentes' : !!estado && s.dataset.estado === estado)
  );

  const visibles = (soloUrgentes ? pedidos.filter(esUrgente) : porFecha).filter((p) => {
    if (estado && p.estado !== estado) return false;
    if (!texto) return true;
    return [p.cliente_nombre, p.cliente_telefono, p.tematica].some((v) => String(v || '').toLowerCase().includes(texto));
  });

  $('#lista-vacia').hidden = visibles.length > 0;
  const lista = $('#lista-pedidos');
  lista.classList.toggle('entrada', animarEntrada);
  animarEntrada = false;
  lista.innerHTML = visibles.map(tarjeta).join('');
  recienLlegados.clear();
}

function tarjeta(p, i = 0) {
  const { dia, hora } = fmtFecha(p.fecha_entrega);
  const saldo = Math.max((Number(p.precio_total) || 0) - (Number(p.sena) || 0), 0);
  const atrasado = p.estado !== 'Entregado' && new Date(p.fecha_entrega) < new Date();
  const urgente = esUrgente(p);
  const claseEstado = 'est-' + String(p.estado).replace(/\s/g, '');
  const tel = String(p.cliente_telefono || '').replace(/\D/g, '');
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
    <p class="pedido-tema">${esc(p.tematica)}</p>
    <dl class="pedido-detalles">
      <dt>Bizcochuelo</dt><dd>${esc(p.sabor_bizcocho)}</dd>
      <dt>Tamaño</dt><dd>${esc(p.peso_porciones)}</dd>
      <dt>Rellenos</dt><dd>${esc(rellenos)}</dd>
    </dl>
    <div class="pedido-pago">
      <span class="pill">Total ${dinero(p.precio_total)}</span>
      <span class="pill">Seña ${dinero(p.sena)} · ${esc(p.sena_medio || '—')}</span>
      <span class="pill ${saldo ? 'pill-saldo' : 'pill-ok'}">${saldo ? 'Saldo ' + dinero(saldo) : 'Pagado'}</span>
    </div>
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
  } catch (err) {
    console.error('Error al eliminar:', err);
    toast(esErrorDeRed(err) ? 'Sin conexión: no se eliminó.' : 'No se pudo eliminar el pedido.', 'error');
  }
}

// Delegación de eventos en la lista
$('#lista-pedidos').addEventListener('change', (e) => {
  if (e.target.dataset.accion === 'estado') {
    cambiarEstado(e.target.closest('.pedido').dataset.id, e.target.value, e.target);
  }
});
$('#lista-pedidos').addEventListener('click', (e) => {
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

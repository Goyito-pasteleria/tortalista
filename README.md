# TortaLista · PWA de pedidos de tortas

## Archivos
| Archivo | Para qué sirve |
|---|---|
| `index.html` | Contenedor con las vistas Cliente (`#/`), Login y Panel (`#/admin`) |
| `style.css` | Diseño mobile-first con paleta cálida de pastelería |
| `app.js` | Supabase, formulario, cola offline, login, panel en tiempo real |
| `manifest.json` | Configuración PWA (instalable, `standalone`) |
| `sw.js` | Service Worker con caché para funcionar offline |
| `supabase.sql` | Tabla `pedidos_tortas`, tabla `administradores` y políticas RLS |
| `icons/` | Íconos 192, 512 y maskable |

## 1. Configurar Supabase
1. Crear un proyecto gratis en https://supabase.com.
2. **SQL Editor → New query** → pegar `supabase.sql` → **Run**.
3. **Authentication → Users → Add user**: correo y contraseña de la pastelería, con *Auto Confirm User*.
4. Volver al SQL Editor y ejecutar (con ese correo):
   ```sql
   insert into public.administradores (user_id)
   select id from auth.users where email = 'pasteleria@ejemplo.com';
   ```
5. **Authentication → Sign In / Providers → Email**: desactivar *Allow new users to sign up* (nadie más puede crear cuentas).
6. **Project Settings → API**: copiar *Project URL* y la clave *anon / publishable* y pegarlas al principio de `app.js`:
   ```js
   const SUPABASE_URL = 'https://xxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
   La clave *anon* es pública por diseño: la seguridad la dan las políticas RLS. **Nunca** pongas la *service_role* en el código.

## 2. Probar en tu PC
Los Service Workers necesitan `http://localhost` o HTTPS (no funcionan abriendo el archivo con doble clic).
- VS Code: extensión **Live Server** → clic derecho en `index.html` → *Open with Live Server*.
- O en una terminal dentro de la carpeta: `python -m http.server 8000` → abrir http://localhost:8000

## 3. Publicar gratis en GitHub Pages
1. Crear un repositorio público en GitHub (ej. `tortalista`).
2. Subir **el contenido** de esta carpeta a la raíz del repo (*Add file → Upload files*, o con git).
3. **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. En 1–2 minutos queda en `https://TU-USUARIO.github.io/tortalista/`.
   - Link para clientes: `https://TU-USUARIO.github.io/tortalista/`
   - Panel de la pastelería: `https://TU-USUARIO.github.io/tortalista/#/admin`
5. En Supabase → **Authentication → URL Configuration**, poner esa dirección como *Site URL*.

## 4. Instalar como app
- Android (Chrome): menú ⋮ → *Agregar a pantalla principal / Instalar app*.
- iPhone (Safari): Compartir → *Agregar a inicio*.
- PC (Chrome/Edge): ícono de instalar en la barra de direcciones.

## 5. Al actualizar el código
Cambiá `const VERSION = 'tortalista-v1'` en `sw.js` (v2, v3…) para que los dispositivos descarguen los archivos nuevos.

## Cómo funciona el modo offline
- Si el cliente envía sin conexión (o falla la red), el pedido se guarda en `localStorage` con un ID único, se muestra un aviso y se reenvía solo al volver internet (o al abrir la app de nuevo). El ID evita duplicados si un reintento llega dos veces.
- El panel necesita internet para leer pedidos; si se corta muestra un aviso sin romperse.

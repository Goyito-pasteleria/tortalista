-- =========================================================
-- TortaLista · ACTUALIZACIÓN 6 (seña por transferencia + comprobante)
-- IMPORTANTE: ejecutar DESPUÉS de publicar la versión 11 de la app
-- (la v10 manda pedidos sin comprobante y esta regla se los rechazaría).
-- Pegar en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar varias veces sin error.
-- =========================================================

-- 1) Columnas nuevas
--    origen: 'Online' (lo carga el cliente) o 'Presencial' (lo carga la pastelería en el panel)
--    comprobante_path: archivo del comprobante de la transferencia
alter table public.pedidos_tortas
  add column if not exists origen           text not null default 'Online',
  add column if not exists comprobante_path text;

alter table public.pedidos_tortas drop constraint if exists origen_valido;
alter table public.pedidos_tortas add constraint origen_valido
  check (origen in ('Online', 'Presencial')) not valid;

-- 2) Pedidos online: seña de al menos $10.000, por transferencia y con comprobante
drop policy if exists "clientes_insertan" on public.pedidos_tortas;
create policy "clientes_insertan" on public.pedidos_tortas
  for insert to anon, authenticated
  with check (
    estado = 'Pendiente'
    and origen = 'Online'
    and precio_total is null
    and sena_confirmada_at is null
    and sena >= 10000
    and sena_medio = 'Transferencia'
    and comprobante_path in (id::text || '/comprobante.jpg', id::text || '/comprobante.pdf')
    and (imagen_path is null or imagen_path = id::text || '/referencia.jpg')
  );

-- 3) Pedidos presenciales: solo la pastelería (admin) los carga, ya confirmados
drop policy if exists "admin_inserta" on public.pedidos_tortas;
create policy "admin_inserta" on public.pedidos_tortas
  for insert to authenticated
  with check (public.es_admin());

-- 4) Lugar PRIVADO para los comprobantes (máx. 5 MB, foto JPG o PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880, array['image/jpeg', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Solo se acepta el comprobante si ya existe un pedido reciente (últimos 7 días) que lo espera
create or replace function public.pedido_espera_comprobante(ruta text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.pedidos_tortas
    where comprobante_path = ruta
      and created_at > now() - interval '7 days'
  );
$$;

drop policy if exists "clientes_suben_comprobantes" on storage.objects;
create policy "clientes_suben_comprobantes" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'comprobantes'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/comprobante\.(jpg|pdf)$'
    and public.pedido_espera_comprobante(name)
  );

-- Solo la pastelería (admin) puede VER y BORRAR los comprobantes
drop policy if exists "admin_ve_comprobantes" on storage.objects;
create policy "admin_ve_comprobantes" on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes' and public.es_admin());

drop policy if exists "admin_borra_comprobantes" on storage.objects;
create policy "admin_borra_comprobantes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprobantes' and public.es_admin());

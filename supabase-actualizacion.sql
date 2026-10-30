-- =========================================================
-- TortaLista · ACTUALIZACIÓN 2
-- Imagen de ejemplo, tortas listas, comentarios, máx. 3 rellenos.
-- Pegar en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar varias veces sin error.
-- =========================================================

-- 1) Columnas nuevas en los pedidos
alter table public.pedidos_tortas
  add column if not exists tipo        text not null default 'Personalizada',
  add column if not exists torta_lista text,
  add column if not exists comentarios text,
  add column if not exists imagen_path text;

-- Las tortas listas no llevan temática
alter table public.pedidos_tortas alter column tematica drop not null;

-- Reglas nuevas (NOT VALID = no revisa pedidos viejos, solo los nuevos)
alter table public.pedidos_tortas drop constraint if exists tipo_valido;
alter table public.pedidos_tortas add constraint tipo_valido
  check (tipo in ('Personalizada', 'Lista')) not valid;

alter table public.pedidos_tortas drop constraint if exists max_tres_rellenos;
alter table public.pedidos_tortas add constraint max_tres_rellenos
  check (cardinality(rellenos) <= 3) not valid;

alter table public.pedidos_tortas drop constraint if exists sabor_valido;
alter table public.pedidos_tortas add constraint sabor_valido
  check (sabor_bizcocho in ('Vainilla', 'Chocolate')) not valid;

alter table public.pedidos_tortas drop constraint if exists comentarios_largo;
alter table public.pedidos_tortas add constraint comentarios_largo
  check (comentarios is null or char_length(comentarios) <= 300) not valid;

-- 2) Lugar PRIVADO para las fotos de ejemplo (máx. 5 MB, solo imágenes)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('referencias', 'referencias', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3) Permisos de las fotos
-- Los clientes solo pueden SUBIR (no ver ni borrar fotos ajenas)
drop policy if exists "clientes_suben_referencias" on storage.objects;
create policy "clientes_suben_referencias" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'referencias');

-- Solo la pastelería (admin) puede VER y BORRAR las fotos
drop policy if exists "admin_ve_referencias" on storage.objects;
create policy "admin_ve_referencias" on storage.objects
  for select to authenticated
  using (bucket_id = 'referencias' and public.es_admin());

drop policy if exists "admin_borra_referencias" on storage.objects;
create policy "admin_borra_referencias" on storage.objects
  for delete to authenticated
  using (bucket_id = 'referencias' and public.es_admin());

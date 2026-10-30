-- =========================================================
-- TortaLista · Esquema y seguridad (pegar en Supabase → SQL Editor → Run)
-- =========================================================
-- IMPORTANTE: en una instalación nueva, después de este archivo ejecutá también supabase-actualizacion.sql

-- 1) Tabla de pedidos
create table if not exists public.pedidos_tortas (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  cliente_nombre   text not null check (char_length(cliente_nombre) between 2 and 80),
  cliente_telefono text not null check (char_length(cliente_telefono) between 6 and 25),
  fecha_entrega    timestamptz not null,
  tematica         text not null check (char_length(tematica) <= 500),
  sabor_bizcocho   text not null,
  rellenos         text[] not null default '{}',
  peso_porciones   text not null,
  precio_total     numeric(12,2) not null check (precio_total >= 0),
  sena             numeric(12,2) not null default 0 check (sena >= 0),
  sena_medio       text default 'Efectivo',
  estado           text not null default 'Pendiente'
                   check (estado in ('Pendiente', 'En Proceso', 'Entregado')),
  constraint sena_no_supera_total check (sena <= precio_total)
);

create index if not exists pedidos_tortas_fecha_idx on public.pedidos_tortas (fecha_entrega);

-- 2) Lista de administradores (solo estos usuarios ven el panel)
create table if not exists public.administradores (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- Función auxiliar: ¿el usuario actual es admin?
create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.administradores where user_id = auth.uid());
$$;

-- 3) Row Level Security
alter table public.pedidos_tortas enable row level security;
alter table public.administradores enable row level security;

-- Cualquiera (cliente anónimo o logueado) puede CREAR pedidos, siempre como "Pendiente"
drop policy if exists "clientes_insertan" on public.pedidos_tortas;
create policy "clientes_insertan" on public.pedidos_tortas
  for insert to anon, authenticated
  with check (estado = 'Pendiente');

-- Solo admins pueden LEER, MODIFICAR y BORRAR
drop policy if exists "admin_lee" on public.pedidos_tortas;
create policy "admin_lee" on public.pedidos_tortas
  for select to authenticated using (public.es_admin());

drop policy if exists "admin_modifica" on public.pedidos_tortas;
create policy "admin_modifica" on public.pedidos_tortas
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "admin_borra" on public.pedidos_tortas;
create policy "admin_borra" on public.pedidos_tortas
  for delete to authenticated using (public.es_admin());

-- Cada usuario solo puede comprobar si él mismo es admin
drop policy if exists "ver_mi_rol" on public.administradores;
create policy "ver_mi_rol" on public.administradores
  for select to authenticated using (user_id = auth.uid());

-- 4) Tiempo real (el panel recibe los pedidos nuevos al instante)
-- (se puede ejecutar varias veces sin error)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pedidos_tortas'
  ) then
    alter publication supabase_realtime add table public.pedidos_tortas;
  end if;
end $$;

-- =========================================================
-- 5) DAR DE ALTA AL ADMINISTRADOR (después de crear el usuario en
--    Authentication → Users → Add user, con "Auto Confirm User"):
--
-- insert into public.administradores (user_id)
-- select id from auth.users where email = 'pasteleria@ejemplo.com';
-- =========================================================

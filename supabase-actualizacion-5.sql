-- =========================================================
-- TortaLista · ACTUALIZACIÓN 5 (seguridad: spam y fotos)
-- IMPORTANTE: ejecutar DESPUÉS de publicar la versión 10 de la app
-- (la v10 guarda el pedido antes de subir la foto; la v9 lo hace al revés).
-- Pegar en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar varias veces sin error.
-- =========================================================

-- 1) Límite de pedidos (evita que un script llene el panel de pedidos falsos)
--    · máx. 3 pedidos por teléfono por hora
--    · máx. 20 pedidos en total cada 10 minutos
--    Además la fecha de creación la pone siempre el servidor (el cliente no puede inventarla).
create index if not exists pedidos_tortas_creado_idx on public.pedidos_tortas (created_at);

create or replace function public.limitar_pedidos()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  tel text := regexp_replace(new.cliente_telefono, '\D', '', 'g');
begin
  new.created_at := now();
  if public.es_admin() then
    return new;
  end if;

  -- Un pedido a la vez: así dos envíos simultáneos no esquivan el límite
  perform pg_advisory_xact_lock(hashtext('tortalista_limite_pedidos'));

  if (select count(*) from public.pedidos_tortas
      where created_at > now() - interval '1 hour'
        and regexp_replace(cliente_telefono, '\D', '', 'g') = tel) >= 3 then
    raise exception 'TL_LIMITE_TELEFONO' using errcode = 'P0001';
  end if;

  if (select count(*) from public.pedidos_tortas
      where created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'TL_LIMITE_GLOBAL' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists limitar_pedidos on public.pedidos_tortas;
create trigger limitar_pedidos
  before insert on public.pedidos_tortas
  for each row execute function public.limitar_pedidos();

-- 2) La ruta de la foto, si viene, tiene que ser la del propio pedido
drop policy if exists "clientes_insertan" on public.pedidos_tortas;
create policy "clientes_insertan" on public.pedidos_tortas
  for insert to anon, authenticated
  with check (
    estado = 'Pendiente'
    and precio_total is null
    and sena_confirmada_at is null
    and (imagen_path is null or imagen_path = id::text || '/referencia.jpg')
  );

-- 3) Fotos: solo se aceptan si ya existe un pedido reciente (últimos 7 días) que la espera.
--    Sin pedido no hay foto → no se puede llenar el espacio con archivos sueltos.
create or replace function public.pedido_espera_foto(ruta text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.pedidos_tortas
    where imagen_path = ruta
      and created_at > now() - interval '7 days'
  );
$$;

drop policy if exists "clientes_suben_referencias" on storage.objects;
create policy "clientes_suben_referencias" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'referencias'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referencia\.jpg$'
    and public.pedido_espera_foto(name)
  );

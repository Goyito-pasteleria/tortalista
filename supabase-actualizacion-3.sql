-- =========================================================
-- TortaLista · ACTUALIZACIÓN 3 (seguridad)
-- Ejecutar DESPUÉS de supabase-actualizacion.sql.
-- Pegar en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar varias veces sin error.
-- =========================================================

-- 1) Largo máximo en los campos de texto que no tenían límite
alter table public.pedidos_tortas drop constraint if exists peso_porciones_largo;
alter table public.pedidos_tortas add constraint peso_porciones_largo
  check (char_length(peso_porciones) <= 60) not valid;

alter table public.pedidos_tortas drop constraint if exists sena_medio_largo;
alter table public.pedidos_tortas add constraint sena_medio_largo
  check (sena_medio is null or char_length(sena_medio) <= 30) not valid;

alter table public.pedidos_tortas drop constraint if exists torta_lista_largo;
alter table public.pedidos_tortas add constraint torta_lista_largo
  check (torta_lista is null or char_length(torta_lista) <= 60) not valid;

-- 2) Una torta personalizada siempre trae temática
alter table public.pedidos_tortas drop constraint if exists tematica_si_personalizada;
alter table public.pedidos_tortas add constraint tematica_si_personalizada
  check (tipo <> 'Personalizada' or char_length(coalesce(tematica, '')) >= 3) not valid;

-- 3) No se aceptan entregas en el pasado (1 hora de margen por relojes desfasados)
alter table public.pedidos_tortas drop constraint if exists entrega_futura;
alter table public.pedidos_tortas add constraint entrega_futura
  check (fecha_entrega > created_at - interval '1 hour') not valid;

-- 4) El precio final lo define la pastelería, no el cliente
--    (la regla "seña no supera el total" sigue valiendo cuando el precio está cargado)
alter table public.pedidos_tortas alter column precio_total drop not null;

drop policy if exists "clientes_insertan" on public.pedidos_tortas;
create policy "clientes_insertan" on public.pedidos_tortas
  for insert to anon, authenticated
  with check (estado = 'Pendiente' and precio_total is null);

-- 5) Fotos: el cliente solo puede subir UNA foto por pedido, con el nombre que usa la app
--    (<id-del-pedido>/referencia.jpg). Evita que se llene el espacio con archivos sueltos.
drop policy if exists "clientes_suben_referencias" on storage.objects;
create policy "clientes_suben_referencias" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'referencias'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referencia\.jpg$'
  );

-- =========================================================
-- TortaLista · ACTUALIZACIÓN 4 (confirmación de la seña)
-- La pastelería confirma el pedido cuando recibe la seña:
-- Pendiente → Confirmado → En Proceso → Entregado
-- Pegar en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar varias veces sin error.
-- =========================================================

-- 1) Fecha en que la pastelería confirmó que recibió la seña
alter table public.pedidos_tortas
  add column if not exists sena_confirmada_at timestamptz;

-- 2) Nuevo estado "Confirmado" (se reemplaza la regla de estados anterior)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.pedidos_tortas'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%estado%'
      and pg_get_constraintdef(oid) ilike '%En Proceso%'
  loop
    execute format('alter table public.pedidos_tortas drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.pedidos_tortas add constraint estado_valido
  check (estado in ('Pendiente', 'Confirmado', 'En Proceso', 'Entregado'));

-- 3) Un cliente nunca puede crear un pedido ya confirmado ni con precio
drop policy if exists "clientes_insertan" on public.pedidos_tortas;
create policy "clientes_insertan" on public.pedidos_tortas
  for insert to anon, authenticated
  with check (estado = 'Pendiente' and precio_total is null and sena_confirmada_at is null);

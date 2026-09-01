begin;

alter table public.yan_orders
  add column if not exists fulfillment_mode text not null default 'on_site',
  add column if not exists delivery_due_date date,
  add column if not exists delivery_status text not null default 'not_required',
  add column if not exists delivered_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_orders_fulfillment_mode_check'
      and conrelid = 'public.yan_orders'::regclass
  ) then
    alter table public.yan_orders
      add constraint yan_orders_fulfillment_mode_check
      check (fulfillment_mode in ('on_site', 'pickup'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_orders_delivery_status_check'
      and conrelid = 'public.yan_orders'::regclass
  ) then
    alter table public.yan_orders
      add constraint yan_orders_delivery_status_check
      check (delivery_status in ('not_required', 'pending', 'delivered'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_orders_delivery_consistency_check'
      and conrelid = 'public.yan_orders'::regclass
  ) then
    alter table public.yan_orders
      add constraint yan_orders_delivery_consistency_check
      check (
        (fulfillment_mode = 'on_site' and delivery_status = 'not_required' and delivery_due_date is null)
        or
        (fulfillment_mode = 'pickup' and delivery_status in ('pending', 'delivered') and delivery_due_date is not null)
      );
  end if;
end $$;

create index if not exists yan_orders_pending_delivery_idx
  on public.yan_orders(delivery_due_date, created_at)
  where fulfillment_mode = 'pickup' and delivery_status = 'pending';

create or replace function public.yan_complete_order_with_fulfillment(
  p_order_id uuid,
  p_fulfillment_mode text,
  p_delivery_due_date date default null,
  p_payment_mode text default 'paid',
  p_installments integer default 1,
  p_first_due_date date default current_date,
  p_method text default 'pix'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not yan_private.yan_is_active_staff() then raise exception 'Acesso nao autorizado.'; end if;
  if p_fulfillment_mode not in ('on_site', 'pickup') then raise exception 'Informe se o servico foi feito no local ou retirado.'; end if;
  if p_fulfillment_mode = 'pickup' and (p_delivery_due_date is null or p_delivery_due_date < current_date) then
    raise exception 'Informe uma data valida para devolver o tapete.';
  end if;

  perform public.yan_complete_order(
    p_order_id,
    case when p_fulfillment_mode = 'pickup' then 'due' else p_payment_mode end,
    case when p_fulfillment_mode = 'pickup' then 1 else p_installments end,
    case when p_fulfillment_mode = 'pickup' then p_delivery_due_date else p_first_due_date end,
    p_method
  );

  update public.yan_orders
  set fulfillment_mode = p_fulfillment_mode,
      delivery_due_date = case when p_fulfillment_mode = 'pickup' then p_delivery_due_date else null end,
      delivery_status = case when p_fulfillment_mode = 'pickup' then 'pending' else 'not_required' end,
      delivered_at = null
  where id = p_order_id;

  if p_fulfillment_mode = 'pickup' then
    insert into public.yan_order_events (order_id, author_id, kind, body, metadata)
    values (
      p_order_id,
      auth.uid(),
      'status',
      'Tapete retirado. Aguardando devolucao e pagamento na entrega.',
      jsonb_build_object('delivery_due_date', p_delivery_due_date)
    );
  end if;
end;
$$;

create or replace function public.yan_deliver_order(
  p_order_id uuid,
  p_method text default 'pix'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.yan_orders%rowtype;
  v_receivable public.yan_receivables%rowtype;
begin
  if not yan_private.yan_is_active_staff() then raise exception 'Acesso nao autorizado.'; end if;
  if p_method not in ('pix', 'cash', 'card', 'transfer', 'other') then raise exception 'Meio de pagamento invalido.'; end if;

  select * into v_order
  from public.yan_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Ordem nao encontrada.'; end if;
  if v_order.fulfillment_mode <> 'pickup' or v_order.delivery_status <> 'pending' then
    raise exception 'Esta entrega ja foi concluida ou nao esta pendente.';
  end if;

  select * into v_receivable
  from public.yan_receivables
  where order_id = p_order_id and status in ('pending', 'partial')
  order by installment_number
  limit 1
  for update;

  if not found then raise exception 'Nao foi encontrado pagamento pendente para esta entrega.'; end if;

  insert into public.yan_payments (order_id, receivable_id, kind, amount, method, notes, created_by)
  values (p_order_id, v_receivable.id, 'payment', v_receivable.balance, p_method, 'Recebido na entrega do tapete.', auth.uid());

  update public.yan_receivables
  set paid_amount = amount,
      balance = 0,
      status = 'paid',
      paid_at = now()
  where id = v_receivable.id;

  update public.yan_orders
  set delivery_status = 'delivered', delivered_at = now()
  where id = p_order_id;

  insert into public.yan_order_events (order_id, author_id, kind, body, metadata)
  values (
    p_order_id,
    auth.uid(),
    'status',
    'Tapete entregue e pagamento recebido.',
    jsonb_build_object('payment_method', p_method, 'amount', v_receivable.balance)
  );
end;
$$;

revoke all on function public.yan_complete_order_with_fulfillment(uuid, text, date, text, integer, date, text) from public, anon;
grant execute on function public.yan_complete_order_with_fulfillment(uuid, text, date, text, integer, date, text) to authenticated;

revoke all on function public.yan_deliver_order(uuid, text) from public, anon;
grant execute on function public.yan_deliver_order(uuid, text) to authenticated;

commit;

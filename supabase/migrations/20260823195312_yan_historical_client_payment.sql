begin;

create or replace function public.yan_record_historical_payment(
  p_order_id uuid,
  p_occurred_at timestamptz,
  p_method text default 'pix'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.yan_orders%rowtype;
  v_receivable_id uuid;
begin
  if not yan_private.yan_is_active_staff() then raise exception 'Acesso nao autorizado.'; end if;
  if p_method not in ('pix', 'cash', 'card', 'transfer', 'other') then raise exception 'Meio de pagamento invalido.'; end if;

  select * into v_order from public.yan_orders where id = p_order_id for update;
  if not found then raise exception 'Ordem nao encontrada.'; end if;
  if v_order.status <> 'completed' then raise exception 'Somente um atendimento historico concluido pode ser marcado como pago.'; end if;
  if v_order.total <= 0 then raise exception 'Informe ao menos um valor antes de marcar como pago.'; end if;
  if exists (select 1 from public.yan_receivables where order_id = p_order_id) then raise exception 'Esta ordem ja possui lancamento financeiro.'; end if;

  insert into public.yan_receivables (
    order_id, installment_number, amount, paid_amount, balance, due_date, status, paid_at
  ) values (
    p_order_id, 1, v_order.total, v_order.total, 0, p_occurred_at::date, 'paid', p_occurred_at
  ) returning id into v_receivable_id;

  insert into public.yan_payments (
    order_id, receivable_id, kind, amount, method, occurred_at, created_by
  ) values (
    p_order_id, v_receivable_id, 'payment', v_order.total, p_method, p_occurred_at, auth.uid()
  );

  insert into public.yan_order_events (order_id, author_id, kind, body, metadata)
  values (p_order_id, auth.uid(), 'payment', 'Pagamento historico registrado.', jsonb_build_object('method', p_method, 'occurred_at', p_occurred_at));
end;
$$;

revoke all on function public.yan_record_historical_payment(uuid, timestamptz, text) from public, anon;
grant execute on function public.yan_record_historical_payment(uuid, timestamptz, text) to authenticated;

commit;

begin;

alter table public.yan_settings
  add column if not exists workdays integer[] not null default array[1, 2, 3, 4, 5, 6],
  add column if not exists work_start time not null default '08:00',
  add column if not exists work_end time not null default '18:00',
  add column if not exists slot_interval_minutes integer not null default 60,
  add column if not exists pdf_title text not null default 'Comprovante de servico e garantia',
  add column if not exists pdf_intro text not null default 'Obrigado por confiar na Yan Limpeza. Este documento registra o atendimento realizado.',
  add column if not exists pdf_service_notes text not null default 'Os servicos abaixo foram executados conforme a avaliacao e o combinado com o cliente.',
  add column if not exists pdf_aftercare text not null default 'Respeite o tempo de secagem orientado pela equipe e mantenha o ambiente ventilado.',
  add column if not exists pdf_payment_notes text not null default 'Guarde este comprovante para consultar pagamentos, garantia e recomendacoes.',
  add column if not exists pdf_footer text not null default 'Yan Limpeza - Higienizacao profissional',
  add column if not exists pdf_show_prices boolean not null default true,
  add column if not exists pdf_show_payment boolean not null default true,
  add column if not exists pdf_show_warranty boolean not null default true,
  add column if not exists pdf_show_photos boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_settings_workdays_check'
      and conrelid = 'public.yan_settings'::regclass
  ) then
    alter table public.yan_settings
      add constraint yan_settings_workdays_check
      check (cardinality(workdays) between 1 and 7 and workdays <@ array[0, 1, 2, 3, 4, 5, 6]);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_settings_work_hours_check'
      and conrelid = 'public.yan_settings'::regclass
  ) then
    alter table public.yan_settings
      add constraint yan_settings_work_hours_check check (work_start < work_end);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_settings_slot_interval_check'
      and conrelid = 'public.yan_settings'::regclass
  ) then
    alter table public.yan_settings
      add constraint yan_settings_slot_interval_check check (slot_interval_minutes between 15 and 240);
  end if;
end $$;

create or replace function public.yan_complete_order(
  p_order_id uuid,
  p_payment_mode text,
  p_installments integer default 1,
  p_first_due_date date default current_date,
  p_method text default 'pix'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.yan_orders%rowtype;
  v_total_cents bigint;
  v_base_cents bigint;
  v_remainder bigint;
  v_piece_cents bigint;
  v_index integer;
  v_receivable_id uuid;
  v_service_count integer;
  v_service_id uuid;
  v_service_names text;
  v_return_value integer;
  v_return_unit text;
  v_return_date date;
begin
  if not yan_private.yan_is_active_staff() then raise exception 'Acesso nao autorizado.'; end if;
  if p_payment_mode not in ('paid', 'due', 'installments') then raise exception 'Forma de pagamento invalida.'; end if;
  if p_installments not between 1 and 36 then raise exception 'Informe de 1 a 36 parcelas.'; end if;
  if p_method not in ('pix', 'cash', 'card', 'transfer', 'other') then raise exception 'Meio de pagamento invalido.'; end if;

  select * into v_order from public.yan_orders where id = p_order_id for update;
  if not found then raise exception 'Ordem nao encontrada.'; end if;
  if v_order.status in ('completed', 'cancelled', 'refunded') then raise exception 'Esta ordem nao pode ser encerrada novamente.'; end if;
  if v_order.total <= 0 then raise exception 'A ordem precisa ter ao menos um servico com valor.'; end if;
  if v_order.scheduled_start is null or v_order.scheduled_end is null then raise exception 'A ordem precisa ter data e hora do servico.'; end if;

  update public.yan_orders
  set status = 'completed', completed_at = now()
  where id = p_order_id;

  select count(distinct i.service_id),
         (array_agg(distinct i.service_id))[1],
         string_agg(distinct s.name, ', ' order by s.name)
  into v_service_count, v_service_id, v_service_names
  from public.yan_order_items i
  join public.yan_services s on s.id = i.service_id
  where i.order_id = p_order_id;

  update public.yan_clients
  set previous_customer = true,
      last_service_date = current_date,
      last_service_description = v_service_names,
      decision_status = 'booked',
      follow_up_at = null
  where id = v_order.client_id;

  v_total_cents := round(v_order.total * 100)::bigint;
  if p_payment_mode = 'paid' then
    insert into public.yan_receivables (
      order_id, installment_number, amount, paid_amount, balance, due_date, status, paid_at
    ) values (
      p_order_id, 1, v_order.total, v_order.total, 0, current_date, 'paid', now()
    ) returning id into v_receivable_id;

    insert into public.yan_payments (order_id, receivable_id, kind, amount, method, created_by)
    values (p_order_id, v_receivable_id, 'payment', v_order.total, p_method, auth.uid());
  else
    if p_payment_mode = 'due' then p_installments := 1; end if;
    v_base_cents := v_total_cents / p_installments;
    v_remainder := v_total_cents % p_installments;
    for v_index in 1..p_installments loop
      v_piece_cents := v_base_cents + case when v_index <= v_remainder then 1 else 0 end;
      insert into public.yan_receivables (
        order_id, installment_number, amount, paid_amount, balance, due_date, status
      ) values (
        p_order_id,
        v_index,
        v_piece_cents::numeric / 100,
        0,
        v_piece_cents::numeric / 100,
        (p_first_due_date + make_interval(months => v_index - 1))::date,
        'pending'
      );
    end loop;
  end if;

  v_return_value := coalesce(v_order.return_value, 6);
  v_return_unit := coalesce(v_order.return_unit, 'months');
  v_return_date := case
    when v_return_unit = 'days' then (current_date + v_return_value)
    else (current_date + make_interval(months => v_return_value))::date
  end;

  insert into public.yan_follow_ups (
    client_id, service_id, source_order_id, due_date, kind, status, notes, created_by
  ) values (
    v_order.client_id,
    case when v_service_count = 1 then v_service_id else null end,
    p_order_id,
    v_return_date,
    'recurrence',
    'pending',
    case
      when v_service_count = 1 then 'Retorno recomendado para ' || coalesce(v_service_names, 'o servico')
      else 'Retorno geral da ordem: ' || coalesce(v_service_names, 'servicos realizados')
    end,
    auth.uid()
  );

  update public.yan_follow_ups
  set status = 'booked'
  where client_id = v_order.client_id
    and status in ('pending', 'contacted', 'snoozed')
    and kind = 'decision';

  insert into public.yan_order_events (order_id, author_id, kind, body, metadata)
  values (
    p_order_id,
    auth.uid(),
    'status',
    'Servico concluido.',
    jsonb_build_object(
      'payment_mode', p_payment_mode,
      'return_date', v_return_date,
      'return_label', coalesce(v_order.return_label, v_return_value || ' ' || v_return_unit)
    )
  );
end;
$$;

revoke all on function public.yan_complete_order(uuid, text, integer, date, text) from public, anon;
grant execute on function public.yan_complete_order(uuid, text, integer, date, text) to authenticated;

commit;

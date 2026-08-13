begin;

alter table public.yan_settings
  add column if not exists warranty_value integer not null default 6,
  add column if not exists warranty_unit text not null default 'months',
  add column if not exists warranty_notes text not null default 'Garantia referente ao serviço executado, conforme as condições informadas pela Yan Limpeza.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_settings_warranty_value_check'
      and conrelid = 'public.yan_settings'::regclass
  ) then
    alter table public.yan_settings
      add constraint yan_settings_warranty_value_check check (warranty_value between 1 and 3650);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_settings_warranty_unit_check'
      and conrelid = 'public.yan_settings'::regclass
  ) then
    alter table public.yan_settings
      add constraint yan_settings_warranty_unit_check check (warranty_unit in ('days', 'months'));
  end if;
end $$;

create table if not exists public.yan_return_presets (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 2 and 80),
  value integer not null check (value between 1 and 3650),
  unit text not null check (unit in ('days', 'months')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid default auth.uid() references public.yan_profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (value, unit)
);

create index if not exists yan_return_presets_created_by_idx on public.yan_return_presets(created_by);
create index if not exists yan_return_presets_active_sort_idx on public.yan_return_presets(active, sort_order, value);

drop trigger if exists yan_return_presets_updated on public.yan_return_presets;
create trigger yan_return_presets_updated
before update on public.yan_return_presets
for each row execute function yan_private.yan_set_updated_at();

insert into public.yan_return_presets (label, value, unit, sort_order)
values
  ('1 dia', 1, 'days', 10),
  ('5 dias', 5, 'days', 20),
  ('10 dias', 10, 'days', 30),
  ('20 dias', 20, 'days', 40),
  ('1 mês', 1, 'months', 50),
  ('3 meses', 3, 'months', 60),
  ('5 meses', 5, 'months', 70),
  ('6 meses', 6, 'months', 80),
  ('8 meses', 8, 'months', 90),
  ('12 meses', 12, 'months', 100)
on conflict (value, unit) do update
set label = excluded.label,
    sort_order = excluded.sort_order,
    active = true;

alter table public.yan_services
  add column if not exists default_return_preset_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_services_default_return_preset_id_fkey'
      and conrelid = 'public.yan_services'::regclass
  ) then
    alter table public.yan_services
      add constraint yan_services_default_return_preset_id_fkey
      foreign key (default_return_preset_id) references public.yan_return_presets(id) on delete set null;
  end if;
end $$;

create index if not exists yan_services_default_return_preset_idx
  on public.yan_services(default_return_preset_id);

update public.yan_services
set default_return_preset_id = (
  select id from public.yan_return_presets where value = 6 and unit = 'months' limit 1
)
where default_return_preset_id is null;

alter table public.yan_service_options
  add column if not exists return_preset_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_service_options_return_preset_id_fkey'
      and conrelid = 'public.yan_service_options'::regclass
  ) then
    alter table public.yan_service_options
      add constraint yan_service_options_return_preset_id_fkey
      foreign key (return_preset_id) references public.yan_return_presets(id) on delete set null;
  end if;
end $$;

create index if not exists yan_service_options_return_preset_idx
  on public.yan_service_options(return_preset_id);

update public.yan_service_options option_row
set return_preset_id = preset.id
from public.yan_return_presets preset
where option_row.return_preset_id is null
  and preset.unit = 'months'
  and preset.value = option_row.return_months;

alter table public.yan_orders
  add column if not exists zipcode text,
  add column if not exists return_value integer,
  add column if not exists return_unit text,
  add column if not exists return_label text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_orders_return_value_check'
      and conrelid = 'public.yan_orders'::regclass
  ) then
    alter table public.yan_orders
      add constraint yan_orders_return_value_check check (return_value is null or return_value between 1 and 3650);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_orders_return_unit_check'
      and conrelid = 'public.yan_orders'::regclass
  ) then
    alter table public.yan_orders
      add constraint yan_orders_return_unit_check check (return_unit is null or return_unit in ('days', 'months'));
  end if;
end $$;

alter table public.yan_order_items
  add column if not exists width_m numeric(10,2),
  add column if not exists length_m numeric(10,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_order_items_width_m_check'
      and conrelid = 'public.yan_order_items'::regclass
  ) then
    alter table public.yan_order_items
      add constraint yan_order_items_width_m_check check (width_m is null or width_m > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'yan_order_items_length_m_check'
      and conrelid = 'public.yan_order_items'::regclass
  ) then
    alter table public.yan_order_items
      add constraint yan_order_items_length_m_check check (length_m is null or length_m > 0);
  end if;
end $$;

create table if not exists public.yan_order_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.yan_orders(id) on delete cascade,
  phase text not null check (phase in ('before', 'after')),
  storage_path text not null unique,
  caption text,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid() references public.yan_profiles(user_id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists yan_order_photos_order_phase_idx
  on public.yan_order_photos(order_id, phase, sort_order, created_at);
create index if not exists yan_order_photos_created_by_idx on public.yan_order_photos(created_by);

create or replace function yan_private.yan_require_order_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.scheduled_start is null or new.scheduled_end is null then
    raise exception 'Informe a data e a hora do serviço antes de abrir a ordem.';
  end if;
  return new;
end;
$$;

drop trigger if exists yan_orders_require_schedule on public.yan_orders;
create trigger yan_orders_require_schedule
before insert on public.yan_orders
for each row execute function yan_private.yan_require_order_schedule();

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
  if not yan_private.yan_is_active_staff() then raise exception 'Acesso não autorizado.'; end if;
  if p_payment_mode not in ('paid', 'due', 'installments') then raise exception 'Forma de pagamento inválida.'; end if;
  if p_installments not between 1 and 36 then raise exception 'Informe de 1 a 36 parcelas.'; end if;
  if p_method not in ('pix', 'cash', 'card', 'transfer', 'other') then raise exception 'Meio de pagamento inválido.'; end if;

  select * into v_order from public.yan_orders where id = p_order_id for update;
  if not found then raise exception 'Ordem não encontrada.'; end if;
  if v_order.status in ('completed', 'cancelled', 'refunded') then raise exception 'Esta ordem não pode ser encerrada novamente.'; end if;
  if v_order.total <= 0 then raise exception 'A ordem precisa ter ao menos um serviço com valor.'; end if;
  if v_order.scheduled_start is null or v_order.scheduled_end is null then raise exception 'A ordem precisa ter data e hora do serviço.'; end if;

  update public.yan_orders
  set status = 'completed', completed_at = now()
  where id = p_order_id;

  select count(distinct i.service_id), min(i.service_id),
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
      when v_service_count = 1 then 'Retorno recomendado para ' || coalesce(v_service_names, 'o serviço')
      else 'Retorno geral da ordem: ' || coalesce(v_service_names, 'serviços realizados')
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
    'Serviço concluído.',
    jsonb_build_object(
      'payment_mode', p_payment_mode,
      'return_date', v_return_date,
      'return_label', coalesce(v_order.return_label, v_return_value || ' ' || v_return_unit)
    )
  );
end;
$$;

alter table public.yan_return_presets enable row level security;
alter table public.yan_order_photos enable row level security;

drop policy if exists yan_return_presets_staff_select on public.yan_return_presets;
create policy yan_return_presets_staff_select on public.yan_return_presets for select to authenticated
using ((select yan_private.yan_is_active_staff()));
drop policy if exists yan_return_presets_admin_insert on public.yan_return_presets;
create policy yan_return_presets_admin_insert on public.yan_return_presets for insert to authenticated
with check ((select yan_private.yan_is_admin()) and created_by = (select auth.uid()));
drop policy if exists yan_return_presets_admin_update on public.yan_return_presets;
create policy yan_return_presets_admin_update on public.yan_return_presets for update to authenticated
using ((select yan_private.yan_is_admin())) with check ((select yan_private.yan_is_admin()));
drop policy if exists yan_return_presets_admin_delete on public.yan_return_presets;
create policy yan_return_presets_admin_delete on public.yan_return_presets for delete to authenticated
using ((select yan_private.yan_is_admin()));

drop policy if exists yan_order_photos_staff_select on public.yan_order_photos;
create policy yan_order_photos_staff_select on public.yan_order_photos for select to authenticated
using ((select yan_private.yan_is_active_staff()));
drop policy if exists yan_order_photos_staff_insert on public.yan_order_photos;
create policy yan_order_photos_staff_insert on public.yan_order_photos for insert to authenticated
with check ((select yan_private.yan_is_active_staff()) and created_by = (select auth.uid()));
drop policy if exists yan_order_photos_staff_delete on public.yan_order_photos;
create policy yan_order_photos_staff_delete on public.yan_order_photos for delete to authenticated
using ((select yan_private.yan_is_active_staff()));

revoke all on public.yan_return_presets, public.yan_order_photos from public, anon, authenticated;
grant select, insert, update, delete on public.yan_return_presets to authenticated;
grant select, insert, delete on public.yan_order_photos to authenticated;

revoke all on function yan_private.yan_require_order_schedule() from public, anon, authenticated;
revoke all on function public.yan_complete_order(uuid, text, integer, date, text) from public, anon;
grant execute on function public.yan_complete_order(uuid, text, integer, date, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'yan-order-photos',
  'yan-order-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists yan_order_photos_storage_select on storage.objects;
create policy yan_order_photos_storage_select on storage.objects for select to authenticated
using (bucket_id = 'yan-order-photos' and (select yan_private.yan_is_active_staff()));
drop policy if exists yan_order_photos_storage_insert on storage.objects;
create policy yan_order_photos_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'yan-order-photos' and (select yan_private.yan_is_active_staff()));
drop policy if exists yan_order_photos_storage_delete on storage.objects;
create policy yan_order_photos_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'yan-order-photos' and (select yan_private.yan_is_active_staff()));

with inserted_puff as (
  insert into public.yan_services (name, icon, description, sort_order, default_return_preset_id)
  select 'Puff', 'armchair', 'Higienização de puff por unidade.', 8,
         (select id from public.yan_return_presets where value = 6 and unit = 'months' limit 1)
  where not exists (select 1 from public.yan_services where lower(name) = 'puff')
  returning id
), puff_service as (
  select id from inserted_puff
  union all
  select id from public.yan_services where lower(name) = 'puff'
  limit 1
)
insert into public.yan_service_options (
  service_id, name, pricing_mode, sale_price, cost_price, duration_minutes,
  return_months, return_preset_id, sort_order
)
select
  puff_service.id,
  'Unidade',
  'per_unit',
  null,
  null,
  30,
  6,
  preset.id,
  1
from puff_service
left join public.yan_return_presets preset on preset.value = 6 and preset.unit = 'months'
where not exists (
  select 1 from public.yan_service_options option_row
  where option_row.service_id = puff_service.id and lower(option_row.name) = 'unidade'
);

commit;

-- Permite cadastrar modelos sem preço fixo e informar o valor ao abrir a ordem.
-- A restrição existente continua impedindo preços negativos quando houver valor.

set local lock_timeout = '5s';

alter table public.yan_service_options
  alter column sale_price drop default,
  alter column sale_price drop not null;

comment on column public.yan_service_options.sale_price is
  'Preço sugerido opcional. Quando nulo, o valor deve ser informado na ordem de serviço.';

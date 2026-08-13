-- Complemento de segurança e desempenho do Yan Limpeza.

revoke all on function public.yan_claim_access(text) from public, anon;
revoke all on function public.yan_admin_set_profile(uuid, boolean, text) from public, anon;
revoke all on function public.yan_check_conflicts(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.yan_complete_order(uuid, text, integer, date, text) from public, anon;
revoke all on function public.yan_receive_payment(uuid, numeric, text, date, text) from public, anon;
revoke all on function public.yan_cancel_order(uuid, text) from public, anon;
revoke all on function public.yan_refund_order(uuid, numeric, text, text) from public, anon;

revoke all on function yan_private.yan_is_active_staff() from public, anon;
revoke all on function yan_private.yan_is_admin() from public, anon;
revoke all on function yan_private.yan_set_updated_at() from public, anon, authenticated;
revoke all on function yan_private.yan_prepare_order_item() from public, anon, authenticated;
revoke all on function yan_private.yan_recalculate_order() from public, anon, authenticated;
revoke all on function yan_private.yan_recalculate_order_discount() from public, anon, authenticated;

grant execute on function public.yan_claim_access(text) to authenticated;
grant execute on function public.yan_admin_set_profile(uuid, boolean, text) to authenticated;
grant execute on function public.yan_check_conflicts(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.yan_complete_order(uuid, text, integer, date, text) to authenticated;
grant execute on function public.yan_receive_payment(uuid, numeric, text, date, text) to authenticated;
grant execute on function public.yan_cancel_order(uuid, text) to authenticated;
grant execute on function public.yan_refund_order(uuid, numeric, text, text) to authenticated;
grant execute on function yan_private.yan_is_active_staff() to authenticated;
grant execute on function yan_private.yan_is_admin() to authenticated;

create index if not exists yan_services_created_by_idx on public.yan_services(created_by);
create index if not exists yan_bootstrap_config_used_by_idx on yan_private.yan_bootstrap_config(used_by);

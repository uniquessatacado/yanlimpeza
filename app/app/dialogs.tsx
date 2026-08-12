"use client";

import { AlertTriangle, Check, ChevronLeft, Loader2, Plus, Save, Trash2, UserPlus, X } from "lucide-react";
import { FormEvent, ReactNode, useMemo, useState } from "react";
import { digits, money, todayIso } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Client, Order, Receivable, Service, ServiceOption } from "../lib/types";

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={wide ? "modal-panel modal-wide" : "modal-panel"} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X /></button></header>{children}</section></div>;
}

type ClientDraft = {
  name: string; whatsapp: string; email: string; previous_customer: boolean; last_service_date: string;
  last_service_description: string; street: string; street_number: string; complement: string; neighborhood: string;
  city: string; state: string; zipcode: string; notes: string;
};

const blankClient: ClientDraft = { name: "", whatsapp: "", email: "", previous_customer: false, last_service_date: "", last_service_description: "", street: "", street_number: "", complement: "", neighborhood: "", city: "Indaiatuba", state: "SP", zipcode: "", notes: "" };

export function ClientDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (client: Client) => void | Promise<void> }) {
  const [form, setForm] = useState<ClientDraft>(blankClient);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const field = (key: keyof ClientDraft, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const phone = digits(form.whatsapp);
    if (phone.length < 10 || phone.length > 15) { setError("Informe um WhatsApp válido, com DDD."); setBusy(false); return; }
    const payload = {
      name: form.name.trim(), whatsapp: phone, email: form.email.trim() || null,
      previous_customer: form.previous_customer, last_service_date: form.last_service_date || null,
      last_service_description: form.last_service_description.trim() || null, street: form.street.trim() || null,
      street_number: form.street_number.trim() || null, complement: form.complement.trim() || null,
      neighborhood: form.neighborhood.trim() || null, city: form.city.trim() || "Indaiatuba",
      state: form.state.trim().toUpperCase() || "SP", zipcode: digits(form.zipcode) || null,
      notes: form.notes.trim() || null, decision_status: "pending" as const, follow_up_at: todayIso(),
    };
    const { data, error: insertError } = await supabase.from("yan_clients").insert(payload).select("*").single();
    if (insertError) setError(insertError.code === "23505" ? "Já existe um cliente com este WhatsApp." : insertError.message);
    else {
      const client = data as Client;
      await supabase.from("yan_follow_ups").insert({ client_id: client.id, due_date: todayIso(), kind: "decision", notes: "Novo atendimento aguardando decisão" });
      await onSaved(client); onClose();
    }
    setBusy(false);
  }

  return <Modal title="Novo atendimento" subtitle="Cadastre o cliente enquanto conversa pelo WhatsApp." onClose={onClose} wide><form className="modal-form" onSubmit={submit}>
    <div className="form-grid two"><label>Nome do cliente<input required minLength={2} value={form.name} onChange={(e) => field("name", e.target.value)} placeholder="Nome completo" /></label><label>WhatsApp<input required inputMode="tel" value={form.whatsapp} onChange={(e) => field("whatsapp", e.target.value)} placeholder="(11) 99999-9999" /></label></div>
    <div className="form-grid two"><label>E-mail <span>opcional</span><input type="email" value={form.email} onChange={(e) => field("email", e.target.value)} placeholder="cliente@email.com" /></label><label>CEP <span>opcional</span><input inputMode="numeric" value={form.zipcode} onChange={(e) => field("zipcode", e.target.value)} placeholder="00000-000" /></label></div>
    <div className="check-panel"><label className="check-line"><input type="checkbox" checked={form.previous_customer} onChange={(e) => field("previous_customer", e.target.checked)} /><span><strong>Este cliente já fez algum serviço?</strong><small>Marque para registrar o histórico anterior.</small></span></label>{form.previous_customer && <div className="form-grid two"><label>Data do último serviço <span>opcional</span><input type="date" value={form.last_service_date} onChange={(e) => field("last_service_date", e.target.value)} /></label><label>Qual serviço? <span>opcional</span><input value={form.last_service_description} onChange={(e) => field("last_service_description", e.target.value)} placeholder="Ex.: sofá e colchão" /></label></div>}</div>
    <div className="form-section-title">Endereço</div><div className="form-grid address"><label className="span-2">Rua<input value={form.street} onChange={(e) => field("street", e.target.value)} placeholder="Rua ou avenida" /></label><label>Número<input value={form.street_number} onChange={(e) => field("street_number", e.target.value)} /></label><label className="span-2">Bairro<input value={form.neighborhood} onChange={(e) => field("neighborhood", e.target.value)} placeholder="Bairro" /></label><label>Complemento<input value={form.complement} onChange={(e) => field("complement", e.target.value)} /></label><label className="span-2">Cidade<input value={form.city} onChange={(e) => field("city", e.target.value)} /></label><label>Estado<input maxLength={2} value={form.state} onChange={(e) => field("state", e.target.value)} /></label></div>
    <label>Observações <span>opcional</span><textarea value={form.notes} onChange={(e) => field("notes", e.target.value)} placeholder="Preferências, referência do endereço ou detalhes do atendimento" /></label>
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <UserPlus />}{busy ? "Cadastrando..." : "Cadastrar cliente"}</button></div>
  </form></Modal>;
}

type ItemDraft = { key: string; serviceId: string; optionId: string; quantity: number; unitPrice: number; unitCost: number; discountType: "fixed" | "percent"; discountValue: number; duration: number };
const newItem = (): ItemDraft => ({ key: crypto.randomUUID(), serviceId: "", optionId: "", quantity: 1, unitPrice: 0, unitCost: 0, discountType: "fixed", discountValue: 0, duration: 60 });

export function OrderDialog({ clients, services, defaultClientId, onClose, onSaved }: { clients: Client[]; services: Service[]; defaultClientId?: string; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [clientId, setClientId] = useState(defaultClientId ?? ""); const [clientSearch, setClientSearch] = useState("");
  const [inlineClient, setInlineClient] = useState(false); const [newClientName, setNewClientName] = useState(""); const [newClientPhone, setNewClientPhone] = useState(""); const [newClientNeighborhood, setNewClientNeighborhood] = useState(""); const [newClientStreet, setNewClientStreet] = useState(""); const [newClientNumber, setNewClientNumber] = useState("");
  const [scheduled, setScheduled] = useState(""); const [notes, setNotes] = useState("");
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed"); const [discountValue, setDiscountValue] = useState(0);
  const [items, setItems] = useState<ItemDraft[]>([newItem()]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");

  const filteredClients = useMemo(() => clients.filter((client) => `${client.name} ${client.whatsapp}`.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 10), [clients, clientSearch]);
  const subtotalAfterItems = items.reduce((sum, item) => { const gross = item.quantity * item.unitPrice; const discount = item.discountType === "percent" ? gross * item.discountValue / 100 : item.discountValue; return sum + Math.max(0, gross - discount); }, 0);
  const generalDiscount = discountType === "percent" ? subtotalAfterItems * discountValue / 100 : discountValue;
  const total = Math.max(0, subtotalAfterItems - generalDiscount);
  const duration = items.reduce((sum, item) => sum + item.duration * Math.max(1, Math.ceil(item.quantity)), 0);

  function changeItem(key: string, patch: Partial<ItemDraft>) { setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item)); }
  function chooseService(key: string, serviceId: string) {
    const service = services.find((entry) => entry.id === serviceId); const option = service?.options?.find((entry) => entry.active) ?? service?.options?.[0];
    changeItem(key, { serviceId, optionId: option?.id ?? "", unitPrice: Number(option?.sale_price ?? 0), unitCost: Number(option?.cost_price ?? 0), duration: option?.duration_minutes ?? 60 });
  }
  function chooseOption(key: string, optionId: string) {
    const option = services.flatMap((service) => service.options ?? []).find((entry) => entry.id === optionId);
    if (option) changeItem(key, { optionId, unitPrice: Number(option.sale_price), unitCost: Number(option.cost_price ?? 0), duration: option.duration_minutes });
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let selectedClient = clients.find((client) => client.id === clientId);
      if (inlineClient) {
        const phone = digits(newClientPhone); if (newClientName.trim().length < 2 || phone.length < 10) throw new Error("Preencha o nome e o WhatsApp do novo cliente.");
        const { data, error: clientError } = await supabase.from("yan_clients").insert({ name: newClientName.trim(), whatsapp: phone, neighborhood: newClientNeighborhood.trim() || null, street: newClientStreet.trim() || null, street_number: newClientNumber.trim() || null, decision_status: "pending", follow_up_at: todayIso() }).select("*").single();
        if (clientError) throw clientError; selectedClient = data as Client;
      }
      if (!selectedClient) throw new Error("Selecione ou cadastre o cliente.");
      const validItems = items.filter((item) => item.serviceId && item.quantity > 0);
      if (!validItems.length) throw new Error("Inclua pelo menos um serviço na ordem.");
      const startsAt = scheduled ? new Date(scheduled) : null; const endsAt = startsAt ? new Date(startsAt.getTime() + duration * 60_000) : null;
      if (startsAt && endsAt) {
        const { data: conflicts, error: conflictError } = await supabase.rpc("yan_check_conflicts", { p_start: startsAt.toISOString(), p_end: endsAt.toISOString(), p_exclude_order_id: null });
        if (conflictError) throw conflictError;
        if (Array.isArray(conflicts) && conflicts.length && !window.confirm(`Conflito detectado com ${conflicts.length} atendimento(s). Deseja salvar mesmo assim?`)) { setBusy(false); return; }
      }
      const { data: orderData, error: orderError } = await supabase.from("yan_orders").insert({
        client_id: selectedClient.id, status: startsAt ? "scheduled" : "draft", scheduled_start: startsAt?.toISOString() ?? null, scheduled_end: endsAt?.toISOString() ?? null,
        street: selectedClient.street, street_number: selectedClient.street_number, complement: selectedClient.complement, neighborhood: selectedClient.neighborhood, city: selectedClient.city, state: selectedClient.state,
        discount_type: discountType, discount_value: discountValue, notes: notes.trim() || null,
      }).select("id,order_number").single();
      if (orderError) throw orderError;
      const payload = validItems.map((item) => {
        const service = services.find((entry) => entry.id === item.serviceId); const option = service?.options?.find((entry) => entry.id === item.optionId);
        return { order_id: orderData.id, service_id: item.serviceId, option_id: item.optionId || null, description: `${service?.name ?? "Serviço"}${option ? ` · ${option.name}` : ""}`, pricing_mode: option?.pricing_mode ?? "fixed", quantity: item.quantity, unit_price: item.unitPrice, unit_cost: item.unitCost, discount_type: item.discountType, discount_value: item.discountValue, duration_minutes: item.duration };
      });
      const { error: itemError } = await supabase.from("yan_order_items").insert(payload); if (itemError) throw itemError;
      await Promise.all([
        supabase.from("yan_order_events").insert({ order_id: orderData.id, kind: "created", body: `Ordem #${orderData.order_number} criada.` }),
        supabase.from("yan_clients").update({ decision_status: "booked", follow_up_at: null }).eq("id", selectedClient.id),
        supabase.from("yan_follow_ups").update({ status: "booked" }).eq("client_id", selectedClient.id).in("status", ["pending", "contacted", "snoozed"]),
      ]);
      await onSaved(); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível criar a ordem."); }
    setBusy(false);
  }

  return <Modal title="Nova ordem de serviço" subtitle="Cliente, serviços, descontos e horário em um só lugar." onClose={onClose} wide><form className="modal-form order-form" onSubmit={submit}>
    <div className="form-section-head"><div><span className="step-dot">1</span><strong>Cliente</strong></div><button type="button" className="text-action" onClick={() => setInlineClient(!inlineClient)}>{inlineClient ? <ChevronLeft /> : <UserPlus />}{inlineClient ? "Escolher cadastrado" : "Cadastrar agora"}</button></div>
    {inlineClient ? <div className="inline-client-box"><div className="form-grid two"><label>Nome<input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Nome completo" /></label><label>WhatsApp<input value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} placeholder="(11) 99999-9999" /></label></div><div className="form-grid address"><label className="span-2">Rua<input value={newClientStreet} onChange={(e) => setNewClientStreet(e.target.value)} /></label><label>Número<input value={newClientNumber} onChange={(e) => setNewClientNumber(e.target.value)} /></label><label className="span-3">Bairro<input value={newClientNeighborhood} onChange={(e) => setNewClientNeighborhood(e.target.value)} /></label></div></div> : <div className="client-picker"><input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} placeholder="Buscar por nome ou WhatsApp" /><div>{filteredClients.map((client) => <button type="button" key={client.id} onClick={() => setClientId(client.id)} className={clientId === client.id ? "selected" : ""}><span>{client.name.slice(0, 1).toUpperCase()}</span><div><strong>{client.name}</strong><small>{client.whatsapp} · {client.neighborhood || "Bairro não informado"}</small></div>{clientId === client.id && <Check />}</button>)}</div></div>}

    <div className="form-section-head"><div><span className="step-dot">2</span><strong>Serviços</strong></div><button type="button" className="text-action" onClick={() => setItems((current) => [...current, newItem()])}><Plus />Adicionar item</button></div>
    <div className="order-items">{items.map((item, index) => {
      const options = services.find((service) => service.id === item.serviceId)?.options ?? [];
      return <div className="order-item-editor" key={item.key}><div className="item-editor-head"><strong>Item {index + 1}</strong>{items.length > 1 && <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}><Trash2 /> Remover</button>}</div><div className="form-grid two"><label>Serviço<select value={item.serviceId} onChange={(e) => chooseService(item.key, e.target.value)}><option value="">Selecione</option>{services.filter((service) => service.active).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Modelo / categoria<select value={item.optionId} onChange={(e) => chooseOption(item.key, e.target.value)}><option value="">Sem modelo</option>{options.filter((option) => option.active).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label></div><div className="form-grid item-values"><label>Quantidade / m²<input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => changeItem(item.key, { quantity: Number(e.target.value) })} /></label><label>Preço unitário<input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => changeItem(item.key, { unitPrice: Number(e.target.value) })} /></label><label>Desconto<select value={item.discountType} onChange={(e) => changeItem(item.key, { discountType: e.target.value as "fixed" | "percent" })}><option value="fixed">R$</option><option value="percent">%</option></select><input type="number" min="0" step="0.01" value={item.discountValue} onChange={(e) => changeItem(item.key, { discountValue: Number(e.target.value) })} /></label><label>Duração (min)<input type="number" min="5" value={item.duration} onChange={(e) => changeItem(item.key, { duration: Number(e.target.value) })} /></label></div></div>;
    })}</div>

    <div className="form-section-head"><div><span className="step-dot">3</span><strong>Agenda e fechamento</strong></div><span className="duration-chip">Duração estimada: {Math.floor(duration / 60)}h{String(duration % 60).padStart(2, "0")}</span></div>
    <div className="form-grid two"><label>Data e hora <span>opcional para orçamento</span><input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} /></label><label>Desconto geral<div className="compound-input"><select value={discountType} onChange={(e) => setDiscountType(e.target.value as "fixed" | "percent")}><option value="fixed">R$</option><option value="percent">%</option></select><input type="number" min="0" step="0.01" value={discountValue} onChange={(e) => setDiscountValue(Number(e.target.value))} /></div></label></div>
    <label>Observações <span>opcional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Acesso ao local, condição das peças ou combinado com o cliente" /></label>
    <div className="order-total"><span><small>Subtotal após descontos</small><strong>{money(subtotalAfterItems)}</strong></span><span><small>Desconto geral</small><strong>− {money(Math.min(subtotalAfterItems, generalDiscount))}</strong></span><span className="grand"><small>Total da ordem</small><strong>{money(total)}</strong></span></div>
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Salvando..." : "Criar ordem"}</button></div>
  </form></Modal>;
}

export function CompleteDialog({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [mode, setMode] = useState<"paid" | "due" | "installments">("paid"); const [installments, setInstallments] = useState(2); const [dueDate, setDueDate] = useState(todayIso()); const [method, setMethod] = useState("pix"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: rpcError } = await supabase.rpc("yan_complete_order", { p_order_id: order.id, p_payment_mode: mode, p_installments: mode === "installments" ? installments : 1, p_first_due_date: dueDate, p_method: method }); if (rpcError) setError(rpcError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title={`Concluir ordem #${order.order_number}`} subtitle={`${order.client?.name ?? "Cliente"} · ${money(order.total)}`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="choice-cards"><button type="button" className={mode === "paid" ? "selected" : ""} onClick={() => setMode("paid")}><Check /><strong>Recebido agora</strong><small>Entra no caixa hoje</small></button><button type="button" className={mode === "due" ? "selected" : ""} onClick={() => setMode("due")}><strong>Para receber</strong><small>Uma data de vencimento</small></button><button type="button" className={mode === "installments" ? "selected" : ""} onClick={() => setMode("installments")}><strong>Parcelado</strong><small>Divide o valor total</small></button></div>{mode !== "paid" && <div className="form-grid two">{mode === "installments" && <label>Quantidade de parcelas<input type="number" min="2" max="36" value={installments} onChange={(e) => setInstallments(Number(e.target.value))} /></label>}<label>Primeiro vencimento<input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label></div>}{mode === "paid" && <label>Meio de recebimento<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label>}{mode === "installments" && <div className="installment-preview">{installments} parcelas de aproximadamente <strong>{money(order.total / installments)}</strong></div>}{error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Voltar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Check />}{busy ? "Concluindo..." : "Concluir serviço"}</button></div></form></Modal>;
}

export function PaymentDialog({ receivable, onClose, onSaved }: { receivable: Receivable; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [amount, setAmount] = useState(Number(receivable.balance)); const [method, setMethod] = useState("pix"); const [nextDate, setNextDate] = useState(receivable.due_date); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const partial = amount < Number(receivable.balance);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: rpcError } = await supabase.rpc("yan_receive_payment", { p_receivable_id: receivable.id, p_amount: amount, p_method: method, p_next_due_date: partial ? nextDate : null, p_notes: notes.trim() || null }); if (rpcError) setError(rpcError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title="Registrar recebimento" subtitle={`Saldo atual: ${money(receivable.balance)}`} onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Valor recebido<input type="number" min="0.01" max={receivable.balance} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label><label>Meio de pagamento<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label>{partial && <div className="partial-box"><strong>Recebimento parcial</strong><p>Restará {money(Number(receivable.balance) - amount)}. Escolha a nova data para cobrar o saldo.</p><label>Próximo vencimento<input type="date" min={todayIso()} value={nextDate} onChange={(e) => setNextDate(e.target.value)} required /></label></div>}<label>Observação <span>opcional</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>{error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Registrando..." : partial ? "Receber parcial" : "Receber total"}</button></div></form></Modal>;
}

export function RefundDialog({ order, available, onClose, onSaved }: { order: Order; available: number; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [amount, setAmount] = useState(available); const [method, setMethod] = useState("pix"); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: rpcError } = await supabase.rpc("yan_refund_order", { p_order_id: order.id, p_amount: amount, p_method: method, p_notes: notes.trim() || null }); if (rpcError) setError(rpcError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title={`Estornar ordem #${order.order_number}`} subtitle={`Disponível para estorno: ${money(available)}`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-alert warning"><AlertTriangle />O estorno será lançado no caixa e ficará registrado no histórico.</div><label>Valor do estorno<input type="number" min="0.01" max={available} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label><label>Forma do estorno<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label><label>Motivo / observação<textarea required value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Descreva por que o valor foi estornado" /></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-danger" disabled={busy}>{busy ? <Loader2 className="spin" /> : "Confirmar estorno"}</button></div></form></Modal>;
}

export function ServiceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: insertError } = await supabase.from("yan_services").insert({ name: name.trim(), description: description.trim() || null }); if (insertError) setError(insertError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title="Novo serviço" subtitle="Depois você poderá adicionar modelos, preços e prazos." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Nome<input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Cabeceira" /></label><label>Descrição <span>opcional</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Plus />}Criar serviço</button></div></form></Modal>;
}

export function EditServiceDialog({ service, onClose, onSaved }: { service: Service; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(service.name); const [description, setDescription] = useState(service.description ?? ""); const [active, setActive] = useState(service.active); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: updateError } = await supabase.from("yan_services").update({ name: name.trim(), description: description.trim() || null, active }).eq("id", service.id); if (updateError) setError(updateError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title={`Editar ${service.name}`} subtitle="Altere o nome, a descrição ou a disponibilidade." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Nome<input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></label><label>Descrição <span>opcional</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label><div className="check-panel"><label className="check-line"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span><strong>Serviço disponível</strong><small>Serviços pausados não aparecem em novas ordens.</small></span></label></div>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}Salvar alterações</button></div></form></Modal>;
}

export function OptionDialog({ service, onClose, onSaved }: { service: Service; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(""); const [mode, setMode] = useState<ServiceOption["pricing_mode"]>("fixed"); const [price, setPrice] = useState(0); const [cost, setCost] = useState<string>(""); const [duration, setDuration] = useState(60); const [months, setMonths] = useState(6); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: insertError } = await supabase.from("yan_service_options").insert({ service_id: service.id, name: name.trim(), pricing_mode: mode, sale_price: price, cost_price: cost === "" ? null : Number(cost), duration_minutes: duration, return_months: months }); if (insertError) setError(insertError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title={`Novo modelo de ${service.name}`} subtitle="Cadastre como o serviço será calculado." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Modelo / categoria<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: 3 lugares" /></label><label>Forma de cálculo<select value={mode} onChange={(e) => setMode(e.target.value as ServiceOption["pricing_mode"])}><option value="fixed">Preço fechado</option><option value="per_unit">Por unidade</option><option value="per_m2">Por metro quadrado</option></select></label><div className="form-grid two"><label>Preço de venda<input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></label><label>Custo <span>opcional</span><input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Não informar" /></label></div><div className="form-grid two"><label>Duração (minutos)<input type="number" min="5" value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></label><label>Retorno recomendado (meses)<input type="number" min="1" max="60" value={months} onChange={(e) => setMonths(Number(e.target.value))} /></label></div>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}Salvar modelo</button></div></form></Modal>;
}

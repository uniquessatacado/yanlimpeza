"use client";

import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, Camera, Check, ChevronLeft,
  Clock3, FileDown, History, House, Loader2, MapPin, MessageCircle, PackageCheck, Pencil, Plus,
  Save, Send, Sparkles, Trash2, Truck, UserPlus, UserRound, X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { dateTime, digits, money, todayIso } from "../lib/format";
import { deliverOrderPdf } from "../lib/order-pdf";
import { supabase } from "../lib/supabase";
import type { Client, Order, Receivable, ReturnPreset, Service, ServiceOption, YanSettings } from "../lib/types";
import { findClientByWhatsapp, uploadOrderPhotos, type AddressDraft } from "../lib/workflow";
import { AddressFields, PhotoPicker, WhatsappField, WizardProgress } from "./wizard-fields";

type ScrollLockSnapshot = {
  x: number;
  y: number;
  html: { overflow: string; overscrollBehavior: string; scrollBehavior: string };
  body: { overflow: string; overscrollBehavior: string; position: string; top: string; left: string; right: string; width: string; paddingRight: string };
};

let openModalCount = 0;
let scrollLockSnapshot: ScrollLockSnapshot | null = null;

function lockPageBehindModal() {
  openModalCount += 1;
  if (openModalCount > 1) return;

  const html = document.documentElement;
  const body = document.body;
  const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
  scrollLockSnapshot = {
    x: window.scrollX,
    y: window.scrollY,
    html: {
      overflow: html.style.overflow,
      overscrollBehavior: html.style.overscrollBehavior,
      scrollBehavior: html.style.scrollBehavior,
    },
    body: {
      overflow: body.style.overflow,
      overscrollBehavior: body.style.overscrollBehavior,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
    },
  };

  html.classList.add("modal-scroll-locked");
  body.classList.add("modal-scroll-locked");
  html.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  body.style.position = "fixed";
  body.style.top = `-${scrollLockSnapshot.y}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
}

function unlockPageBehindModal() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount > 0 || !scrollLockSnapshot) return;

  const snapshot = scrollLockSnapshot;
  scrollLockSnapshot = null;
  const html = document.documentElement;
  const body = document.body;

  html.classList.remove("modal-scroll-locked");
  body.classList.remove("modal-scroll-locked");
  html.style.overflow = snapshot.html.overflow;
  html.style.overscrollBehavior = snapshot.html.overscrollBehavior;
  body.style.overflow = snapshot.body.overflow;
  body.style.overscrollBehavior = snapshot.body.overscrollBehavior;
  body.style.position = snapshot.body.position;
  body.style.top = snapshot.body.top;
  body.style.left = snapshot.body.left;
  body.style.right = snapshot.body.right;
  body.style.width = snapshot.body.width;
  body.style.paddingRight = snapshot.body.paddingRight;

  html.style.scrollBehavior = "auto";
  window.scrollTo(snapshot.x, snapshot.y);
  html.style.scrollBehavior = snapshot.html.scrollBehavior;
}

export function usePageScrollLock(enabled = true, mobileOnly = false) {
  useLayoutEffect(() => {
    if (!enabled || (mobileOnly && !window.matchMedia("(max-width: 900px)").matches)) return;
    lockPageBehindModal();
    return unlockPageBehindModal;
  }, [enabled, mobileOnly]);
}

function useModalKeyboardGuard() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => {
      document.documentElement.style.setProperty("--modal-viewport-height", `${viewport.height}px`);
      document.documentElement.style.setProperty("--modal-viewport-offset", `${viewport.offsetTop}px`);
    };
    sync(); viewport.addEventListener("resize", sync); viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync); viewport.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--modal-viewport-height"); document.documentElement.style.removeProperty("--modal-viewport-offset");
    };
  }, []);
}

export function Modal({ title, subtitle, children, onClose, wide = false, panelClassName = "", closeOnBackdrop = true }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; panelClassName?: string; closeOnBackdrop?: boolean }) {
  usePageScrollLock();
  useModalKeyboardGuard();
  const classes = ["modal-panel", wide ? "modal-wide" : "", panelClassName].filter(Boolean).join(" ");
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose(); }}><section className={classes} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()} onFocusCapture={(event) => { const field = event.target as HTMLElement; if (/^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName)) window.setTimeout(() => field.scrollIntoView({ block: "nearest" }), 180); }}><header className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X /></button></header>{children}</section></div>;
}

type ClientDraft = { name: string; whatsapp: string; previous_customer: boolean; last_service_date: string; last_service_description: string };
const blankClient: ClientDraft = { name: "", whatsapp: "", previous_customer: false, last_service_date: "", last_service_description: "" };
const blankAddress = (): AddressDraft => ({ zipcode: "", street: "", street_number: "", complement: "", neighborhood: "", city: "Indaiatuba", state: "SP" });
function addressFromClient(client?: Client): AddressDraft { return { zipcode: client?.zipcode ?? "", street: client?.street ?? "", street_number: client?.street_number ?? "", complement: client?.complement ?? "", neighborhood: client?.neighborhood ?? "", city: client?.city ?? "Indaiatuba", state: client?.state ?? "SP" }; }
function hasAddress(address: AddressDraft) { return Boolean(address.zipcode || address.street || address.street_number || address.neighborhood || address.complement); }
type ClientHistoryItem = { key: string; serviceId: string; optionId: string; quantity: string; price: string };
const newHistoryItem = (): ClientHistoryItem => ({ key: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, serviceId: "", optionId: "", quantity: "1", price: "" });

type HistoryCatalogDraft = { itemKey: string; kind: "service" | "option"; name: string; price: string; mode: ServiceOption["pricing_mode"]; duration: number };

function HistoryCatalogEditor({ draft, services, presets, onClose, onCreated }: { draft: HistoryCatalogDraft; services: Service[]; presets: ReturnPreset[]; onClose: () => void; onCreated: (service: Service, option?: ServiceOption) => void }) {
  const [name, setName] = useState(draft.name); const [price, setPrice] = useState(draft.price); const [mode, setMode] = useState<ServiceOption["pricing_mode"]>(draft.mode); const [duration, setDuration] = useState(draft.duration); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const service = services.find((entry) => entry.id === draft.itemKey.split("::")[1]);
  const presetId = service?.default_return_preset_id ?? presets.find((entry) => entry.active && entry.value === 6 && entry.unit === "months")?.id ?? presets.find((entry) => entry.active)?.id ?? null;
  const preset = presets.find((entry) => entry.id === presetId);
  async function save() {
    setError(""); if (name.trim().length < 2) return setError(draft.kind === "service" ? "Digite o nome do serviço." : "Digite o nome do modelo."); setBusy(true);
    try {
      if (draft.kind === "service") {
        const { data, error: insertError } = await supabase.from("yan_services").insert({ name: name.trim(), description: null, default_return_preset_id: presetId }).select("*").single();
        if (insertError) throw insertError; onCreated({ ...(data as Service), options: [] });
      } else {
        if (!service) throw new Error("Escolha um serviço antes de criar o modelo.");
        const { data, error: insertError } = await supabase.from("yan_service_options").insert({ service_id: service.id, name: name.trim(), pricing_mode: mode, sale_price: price === "" ? null : Number(price), cost_price: null, duration_minutes: duration, return_months: preset?.unit === "months" ? preset.value : 6, return_preset_id: presetId }).select("*").single();
        if (insertError) throw insertError; onCreated(service, data as ServiceOption);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível cadastrar."); } finally { setBusy(false); }
  }
  return <div className="history-catalog-editor"><div className="history-catalog-title"><span><Plus /></span><div><strong>{draft.kind === "service" ? "Cadastrar serviço agora" : `Novo modelo de ${service?.name ?? "serviço"}`}</strong><small>O novo cadastro será selecionado sem fechar esta tela.</small></div></div><div className="form-grid two"><label>{draft.kind === "service" ? "Nome do serviço" : "Nome do modelo"}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={draft.kind === "service" ? "Ex.: Poltrona" : "Ex.: 3 lugares"} /></label>{draft.kind === "option" && <label>Preço padrão <span>opcional</span><div className="money-field"><i>R$</i><input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Digite o valor" /></div></label>}</div>{draft.kind === "option" && <div className="form-grid two"><label>Forma de cálculo<select value={mode} onChange={(event) => setMode(event.target.value as ServiceOption["pricing_mode"])}><option value="fixed">Preço fechado</option><option value="per_unit">Por unidade</option><option value="per_m2">Por metro quadrado</option></select></label><label>Duração (min)<input type="number" min="5" value={duration || ""} onChange={(event) => setDuration(Number(event.target.value))} placeholder="60" /></label></div>}{error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="history-catalog-actions"><button type="button" className="button-secondary" onClick={onClose}>Voltar</button><button type="button" className="button-admin-primary" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" /> : <Plus />}{busy ? "Salvando..." : draft.kind === "service" ? "Criar serviço" : "Criar modelo"}</button></div></div>;
}

function ClientHistoryEditor({ items, onChange, services, onServicesChange, presets }: { items: ClientHistoryItem[]; onChange: (items: ClientHistoryItem[]) => void; services: Service[]; onServicesChange: React.Dispatch<React.SetStateAction<Service[]>>; presets: ReturnPreset[] }) {
  const [quick, setQuick] = useState<HistoryCatalogDraft | null>(null);
  function patch(key: string, value: Partial<ClientHistoryItem>) { onChange(items.map((item) => item.key === key ? { ...item, ...value } : item)); }
  function created(itemKey: string, service: Service, option?: ServiceOption) {
    onServicesChange((current) => { const found = current.some((entry) => entry.id === service.id); if (!found) return [...current, service]; if (!option) return current; return current.map((entry) => entry.id === service.id ? { ...entry, options: [...(entry.options ?? []), option] } : entry); });
    patch(itemKey, { serviceId: service.id, optionId: option?.id ?? "", price: option?.sale_price === null || option?.sale_price === undefined ? "" : String(option.sale_price) }); setQuick(null);
  }
  const total = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0);
  return <div className="history-services-editor"><div className="history-editor-head"><div><strong>Serviços anteriores</strong><small>Opcional. Adicione quantos precisar.</small></div>{total > 0 && <span>{money(total)}</span>}</div>{items.map((item, index) => { const service = services.find((entry) => entry.id === item.serviceId); const options = service?.options?.filter((entry) => entry.active) ?? []; return <article key={item.key}><header><strong>Serviço {index + 1}</strong>{items.length > 1 && <button type="button" onClick={() => onChange(items.filter((entry) => entry.key !== item.key))}><Trash2 /> Remover</button>}</header><div className="history-service-grid"><label>Serviço<select value={item.serviceId} onChange={(event) => { const selected = services.find((entry) => entry.id === event.target.value); const option = selected?.options?.find((entry) => entry.active); patch(item.key, { serviceId: event.target.value, optionId: option?.id ?? "", price: option?.sale_price === null || option?.sale_price === undefined ? "" : String(option.sale_price) }); }}><option value="">Não informar</option>{services.filter((entry) => entry.active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>Modelo<select value={item.optionId} disabled={!item.serviceId} onChange={(event) => { const option = options.find((entry) => entry.id === event.target.value); patch(item.key, { optionId: event.target.value, price: option?.sale_price === null || option?.sale_price === undefined ? item.price : String(option.sale_price) }); }}><option value="">Sem modelo</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label><label className="history-quantity">Quantidade<input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => patch(item.key, { quantity: event.target.value })} /></label><label className="history-price">Valor cobrado<input type="number" min="0" step="0.01" value={item.price} onChange={(event) => patch(item.key, { price: event.target.value })} placeholder="Digite o valor" /></label></div><div className="history-catalog-buttons"><button type="button" onClick={() => setQuick({ itemKey: item.key, kind: "service", name: "", price: "", mode: "fixed", duration: 60 })}><Plus /> Novo serviço</button><button type="button" disabled={!item.serviceId} onClick={() => item.serviceId && setQuick({ itemKey: `${item.key}::${item.serviceId}`, kind: "option", name: "", price: item.price, mode: "fixed", duration: 60 })}><Plus /> {item.serviceId ? "Novo modelo" : "Escolha o serviço"}</button></div>{quick && (quick.itemKey === item.key || quick.itemKey.startsWith(`${item.key}::`)) && <HistoryCatalogEditor draft={quick} services={services} presets={presets} onClose={() => setQuick(null)} onCreated={(createdService, option) => created(item.key, createdService, option)} />}</article>; })}<button type="button" className="add-history-service" onClick={() => onChange([...items, newHistoryItem()])}><Plus /> Adicionar outro serviço</button></div>;
}

export function ClientDialog({ services, presets, onClose, onSaved }: { services: Service[]; presets: ReturnPreset[]; onClose: () => void; onSaved: (client: Client) => void | Promise<void> }) {
  const [form, setForm] = useState<ClientDraft>(blankClient);
  const [address, setAddress] = useState<AddressDraft>(blankAddress());
  const [step, setStep] = useState(1);
  const [historyChoice, setHistoryChoice] = useState<boolean | null>(null);
  const [historyItems, setHistoryItems] = useState<ClientHistoryItem[]>([newHistoryItem()]);
  const [availableServices, setAvailableServices] = useState<Service[]>(services);
  const [historyPaid, setHistoryPaid] = useState(false); const [historyPaymentMethod, setHistoryPaymentMethod] = useState("pix");
  const [wantsAddress, setWantsAddress] = useState<boolean | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; whatsapp: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const activeServices = availableServices.filter((service) => service.active);

  function nextStep() {
    setError("");
    if (step === 1) {
      const phone = digits(form.whatsapp);
      if (form.name.trim().length < 2) return setError("Digite o nome do cliente para continuar.");
      if (phone.length < 10 || phone.length > 15) return setError("Informe um WhatsApp válido, com DDD.");
      if (duplicate) return setError(`Este WhatsApp já está cadastrado para ${duplicate.name}.`);
    }
    if (step === 2) {
      if (historyChoice === null) return setError("Escolha se este cliente já fez algum serviço.");
      if (historyChoice && !form.last_service_date) return setError("Informe a data em que o serviço foi feito.");
      if (historyChoice && historyPaid && historyItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0) <= 0) return setError("Informe o valor cobrado antes de marcar o histórico como pago.");
    }
    setStep((current) => Math.min(3, current + 1));
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (step < 3) return nextStep(); setBusy(true); setError("");
    try {
      const phone = digits(form.whatsapp);
      if (duplicate || await findClientByWhatsapp(phone)) throw new Error("Este WhatsApp já está cadastrado.");
      const validHistory = historyItems.filter((item) => item.serviceId); const historyNames = validHistory.map((item) => { const service = availableServices.find((entry) => entry.id === item.serviceId); const option = service?.options?.find((entry) => entry.id === item.optionId); return `${service?.name ?? "Serviço"}${option ? ` · ${option.name}` : ""}`; });
      const payload = { name: form.name.trim(), whatsapp: phone, email: null, previous_customer: historyChoice === true, last_service_date: historyChoice ? form.last_service_date : null, last_service_description: historyChoice ? historyNames.join(", ") || null : null, street: wantsAddress ? address.street.trim() || null : null, street_number: wantsAddress ? address.street_number.trim() || null : null, complement: wantsAddress ? address.complement.trim() || null : null, neighborhood: wantsAddress ? address.neighborhood.trim() || null : null, city: wantsAddress ? address.city.trim() || "Indaiatuba" : "Indaiatuba", state: wantsAddress ? address.state.trim().toUpperCase() || "SP" : "SP", zipcode: wantsAddress ? digits(address.zipcode) || null : null, notes: null, decision_status: "pending" as const, follow_up_at: todayIso() };
      const { data, error: insertError } = await supabase.from("yan_clients").insert(payload).select("*").single();
      if (insertError) throw new Error(insertError.code === "23505" ? "Já existe um cliente com este WhatsApp." : insertError.message);
      const client = data as Client;
      if (historyChoice && form.last_service_date && validHistory.length) {
        const startsAt = new Date(`${form.last_service_date}T12:00:00`); const duration = validHistory.reduce((sum, item) => { const service = availableServices.find((entry) => entry.id === item.serviceId); const option = service?.options?.find((entry) => entry.id === item.optionId); return sum + (option?.duration_minutes ?? 60) * Math.max(1, Number(item.quantity || 1)); }, 0); const endsAt = new Date(startsAt.getTime() + duration * 60_000);
        const { data: historicalOrder, error: historicalOrderError } = await supabase.from("yan_orders").insert({ client_id: client.id, status: "completed", scheduled_start: startsAt.toISOString(), scheduled_end: endsAt.toISOString(), completed_at: startsAt.toISOString(), street: payload.street, street_number: payload.street_number, complement: payload.complement, neighborhood: payload.neighborhood, city: payload.city, state: payload.state, zipcode: payload.zipcode, notes: "Atendimento anterior informado no cadastro do cliente." }).select("id,order_number").single();
        if (historicalOrderError) throw historicalOrderError;
        const historicalRows = validHistory.map((item) => { const service = availableServices.find((entry) => entry.id === item.serviceId)!; const option = service.options?.find((entry) => entry.id === item.optionId); return { order_id: historicalOrder.id, service_id: service.id, option_id: option?.id ?? null, description: `${service.name}${option ? ` · ${option.name}` : ""}`, pricing_mode: option?.pricing_mode ?? "fixed", quantity: Math.max(0.01, Number(item.quantity || 1)), unit_price: Number(item.price || 0), unit_cost: Number(option?.cost_price ?? 0), discount_type: "fixed", discount_value: 0, duration_minutes: option?.duration_minutes ?? 60, width_m: null, length_m: null }; });
        const { error: historicalItemsError } = await supabase.from("yan_order_items").insert(historicalRows); if (historicalItemsError) throw historicalItemsError;
        await supabase.from("yan_order_events").insert({ order_id: historicalOrder.id, kind: "created", body: `Histórico anterior registrado no cadastro do cliente. Ordem #${historicalOrder.order_number}.` });
        if (historyPaid) { const { error: historicalPaymentError } = await supabase.rpc("yan_record_historical_payment", { p_order_id: historicalOrder.id, p_occurred_at: startsAt.toISOString(), p_method: historyPaymentMethod }); if (historicalPaymentError) throw historicalPaymentError; }
      }
      await supabase.from("yan_follow_ups").insert({ client_id: client.id, due_date: todayIso(), kind: "decision", notes: "Novo atendimento aguardando decisão" });
      await onSaved(client); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível cadastrar o cliente."); }
    finally { setBusy(false); }
  }

  const subtitles = ["Nome e WhatsApp primeiro, sem complicação.", "A data é obrigatória se ele já foi atendido; o serviço é opcional.", "O endereço nunca é obrigatório."];
  return <Modal title="Cadastrar cliente" subtitle={subtitles[step - 1]} onClose={onClose} panelClassName="modal-client"><form className="modal-form client-wizard" onSubmit={submit}>
    <WizardProgress step={step} labels={["Contato", "Histórico", "Endereço"]} />
    {step === 1 && <section className="wizard-step"><div className="wizard-heading"><span><UserRound /></span><div><strong>Quem é o cliente?</strong><p>As duas informações abaixo são obrigatórias.</p></div></div><label className="visual-field"><span>Nome do cliente <b className="required-mark">obrigatório</b></span><div className="visual-input"><UserRound /><input autoFocus required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Digite o nome completo" autoComplete="name" /></div></label><WhatsappField value={form.whatsapp} onChange={(whatsapp) => setForm({ ...form, whatsapp })} onDuplicate={setDuplicate} /></section>}
    {step === 2 && <section className="wizard-step"><div className="wizard-heading"><span><History /></span><div><strong>Já fez serviço com a Yan?</strong><p>Isso alimenta o histórico e os próximos retornos.</p></div></div><div className="visual-choice-grid two-options"><button type="button" className={historyChoice === true ? "selected" : ""} onClick={() => { setHistoryChoice(true); setForm({ ...form, previous_customer: true }); }}><span><Check /></span><strong>Sim, já fez</strong><small>Registrar atendimento anterior</small></button><button type="button" className={historyChoice === false ? "selected" : ""} onClick={() => { setHistoryChoice(false); setHistoryPaid(false); setForm({ ...form, previous_customer: false, last_service_date: "", last_service_description: "" }); }}><span><Sparkles /></span><strong>Ainda não</strong><small>É um cliente novo</small></button></div>{historyChoice && <div className="wizard-reveal history-reveal client-history-reveal"><label>Quando foi? <b className="required-mark">obrigatório</b><div className="visual-input compact"><CalendarDays /><input required type="date" max={todayIso()} value={form.last_service_date} onChange={(event) => setForm({ ...form, last_service_date: event.target.value })} /></div></label><ClientHistoryEditor items={historyItems} onChange={setHistoryItems} services={activeServices} onServicesChange={setAvailableServices} presets={presets} /><div className={historyPaid ? "history-payment active" : "history-payment"}><label className="switch-row"><input type="checkbox" checked={historyPaid} onChange={(event) => setHistoryPaid(event.target.checked)} /><span>Marcar este atendimento como pago</span></label>{historyPaid && <label>Forma de pagamento<select value={historyPaymentMethod} onChange={(event) => setHistoryPaymentMethod(event.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outro</option></select><small className="field-help">O recebimento entrará na Visão geral usando a data do serviço acima.</small></label>}</div></div>}</section>}
    {step === 3 && <section className="wizard-step"><div className="wizard-heading"><span><MapPin /></span><div><strong>Quer guardar o endereço?</strong><p>É opcional e poderá ser preenchido ou alterado depois.</p></div></div><div className="visual-choice-grid two-options"><button type="button" className={wantsAddress === true ? "selected" : ""} onClick={() => setWantsAddress(true)}><span><House /></span><strong>Adicionar endereço</strong><small>Começar pelo CEP</small></button><button type="button" className={wantsAddress === false ? "selected" : ""} onClick={() => setWantsAddress(false)}><span><ArrowRight /></span><strong>Salvar sem endereço</strong><small>Continuar só com o contato</small></button></div>{wantsAddress && <div className="wizard-reveal address-reveal"><AddressFields value={address} onChange={setAddress} /></div>}</section>}
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}
    <div className="modal-actions wizard-actions">{step === 1 ? <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button> : <button type="button" className="button-secondary" onClick={() => { setError(""); setStep(step - 1); }}><ArrowLeft /> Voltar</button>}{step < 3 ? <button type="button" className="button-admin-primary" onClick={nextStep}>Continuar <ArrowRight /></button> : <button className="button-admin-primary" disabled={busy || Boolean(duplicate)}>{busy ? <Loader2 className="spin" /> : <UserPlus />}{busy ? "Cadastrando..." : "Salvar cliente"}</button>}</div>
  </form></Modal>;
}

export function EditClientDialog({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(client.name);
  const [whatsapp, setWhatsapp] = useState(client.whatsapp);
  const [address, setAddress] = useState<AddressDraft>(addressFromClient(client));
  const [wantsAddress, setWantsAddress] = useState(true);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; whatsapp: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Informe o nome do cliente.");
    if (digits(whatsapp).length < 10) return setError("Informe um WhatsApp válido.");
    if (duplicate) return setError(`Este WhatsApp já pertence a ${duplicate.name}.`);
    setBusy(true);
    try {
      const { error: updateError } = await supabase.from("yan_clients").update({
        name: name.trim(), whatsapp: digits(whatsapp),
        zipcode: wantsAddress ? digits(address.zipcode) || null : null,
        street: wantsAddress ? address.street.trim() || null : null,
        street_number: wantsAddress ? address.street_number.trim() || null : null,
        complement: wantsAddress ? address.complement.trim() || null : null,
        neighborhood: wantsAddress ? address.neighborhood.trim() || null : null,
        city: wantsAddress ? address.city.trim() || "Indaiatuba" : "Indaiatuba",
        state: wantsAddress ? address.state.trim().toUpperCase() || "SP" : "SP",
      }).eq("id", client.id);
      if (updateError) throw new Error(updateError.code === "23505" ? "Este WhatsApp já está em outro cadastro." : updateError.message);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o cliente.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Editar cliente" subtitle={client.name} onClose={onClose} panelClassName="modal-client"><form className="modal-form client-wizard edit-client-form" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <section className="wizard-step"><div className="wizard-heading"><span><Pencil /></span><div><strong>Dados do cliente</strong><p>Nome, WhatsApp e endereço ficam na mesma tela. Nada fecha até você salvar ou cancelar.</p></div></div>
      <label className="visual-field"><span>Nome <b className="required-mark">obrigatório</b></span><div className="visual-input"><UserRound /><input autoFocus required minLength={2} value={name} onChange={(event) => setName(event.target.value)} placeholder="Digite o nome do cliente" autoComplete="name" /></div></label>
      <WhatsappField value={whatsapp} onChange={setWhatsapp} onDuplicate={setDuplicate} excludeClientId={client.id} />
      <div className="wizard-heading"><span><MapPin /></span><div><strong>Endereço</strong><p>Edite qualquer campo abaixo ou remova o endereço do cadastro.</p></div></div>
      <div className="visual-choice-grid two-options"><button type="button" className={wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(true)}><span><House /></span><strong>Usar endereço</strong><small>Editar os dados abaixo</small></button><button type="button" className={!wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(false)}><span><X /></span><strong>Sem endereço</strong><small>Remover do cadastro</small></button></div>
      {wantsAddress && <div className="wizard-reveal address-reveal"><AddressFields value={address} onChange={setAddress} /></div>}
    </section>
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}
    <div className="modal-actions wizard-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button-admin-primary" disabled={busy || Boolean(duplicate)}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Salvando..." : "Salvar cliente e endereço"}</button></div>
  </form></Modal>;
}
export function OrderDetailsDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const paid = (order.payments ?? []).reduce((sum, payment) => sum + (payment.kind === "payment" ? Number(payment.amount) : -Number(payment.amount)), 0);
  const open = (order.receivables ?? []).filter((entry) => ["pending", "partial"].includes(entry.status)).reduce((sum, entry) => sum + Number(entry.balance), 0);
  const address = [order.street, order.street_number, order.complement, order.neighborhood, order.city].filter(Boolean).join(", ");
  return <Modal title={`Ordem #${order.order_number}`} subtitle={`${order.client?.name ?? "Cliente"} · detalhes do atendimento`} onClose={onClose} wide panelClassName="modal-order-details"><div className="modal-form order-details"><div className="order-details-summary"><article><small>Serviço agendado</small><strong>{dateTime(order.scheduled_start)}</strong></article><article><small>Ordem criada</small><strong>{dateTime(order.created_at)}</strong></article><article><small>Status</small><strong>{order.status === "completed" ? "Concluída" : order.status === "in_progress" ? "Em andamento" : order.status === "scheduled" ? "Agendada" : order.status}</strong></article><article><small>Total</small><strong>{money(order.total)}</strong></article></div>{order.delivery_status === "pending" && <section className="order-detail-section delivery-payment-note"><Truck /><span><strong>Entrega pendente</strong><small>Devolução prevista para {shortDeliveryDate(order.delivery_due_date)} e pagamento na entrega.</small></span></section>}<section className="order-detail-section"><h3>Serviços e valores</h3><div className="order-detail-items">{(order.items ?? []).map((item) => <article key={item.id}><div><strong>{item.service?.name ?? item.description}</strong><small>{item.option?.name ?? "Sem modelo"}</small></div><span><small>{item.quantity} × {money(item.unit_price)}</small><strong>{money(item.line_total)}</strong></span></article>)}</div>{order.discount_amount > 0 && <div className="order-detail-discount"><span>Desconto geral</span><strong>− {money(order.discount_amount)}</strong></div>}</section><section className="order-detail-section"><h3>Pagamento</h3><div className="order-payment-summary"><span><small>Pago</small><strong>{money(paid)}</strong></span><span><small>Em aberto</small><strong>{money(open)}</strong></span></div></section><section className="order-detail-section"><h3>Local e observações</h3><p><MapPin />{address || "Endereço não informado"}</p>{order.notes && <p>{order.notes}</p>}</section><div className="modal-actions"><button className="button-admin-primary" onClick={onClose}><Check /> Fechar detalhes</button></div></div></Modal>;
}

type ItemDraft = { key: string; serviceId: string; optionId: string; quantity: number; unitPrice: string; unitCost: number; discountType: "fixed" | "percent"; discountValue: number; duration: number; width: string; length: string };
const draftKey = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const newItem = (): ItemDraft => ({ key: draftKey(), serviceId: "", optionId: "", quantity: 1, unitPrice: "", unitCost: 0, discountType: "fixed", discountValue: 0, duration: 60, width: "", length: "" });
function tomorrowIso(days = 1) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function nextHalfHour() { const date = new Date(Date.now() + 60 * 60_000); date.setMinutes(date.getMinutes() < 30 ? 30 : 0, 0, 0); if (date.getMinutes() === 0) date.setHours(date.getHours() + 1); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }

export function OrderDialog({ clients, services, presets, defaultClientId, onClose, onSaved }: { clients: Client[]; services: Service[]; presets: ReturnPreset[]; defaultClientId?: string; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const initialClient = clients.find((client) => client.id === defaultClientId);
  const [step, setStep] = useState(1); const [clientId, setClientId] = useState(defaultClientId ?? ""); const [clientSearch, setClientSearch] = useState("");
  const [inlineClient, setInlineClient] = useState(false); const [newClientName, setNewClientName] = useState(""); const [newClientPhone, setNewClientPhone] = useState("");
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; whatsapp: string } | null>(null); const [items, setItems] = useState<ItemDraft[]>([newItem()]);
  const [wantsAddress, setWantsAddress] = useState(initialClient ? hasAddress(addressFromClient(initialClient)) : false); const [address, setAddress] = useState<AddressDraft>(addressFromClient(initialClient));
  const [beforeFiles, setBeforeFiles] = useState<File[]>([]); const [scheduledDate, setScheduledDate] = useState(todayIso()); const [scheduledTime, setScheduledTime] = useState(nextHalfHour());
  const [returnPresetId, setReturnPresetId] = useState(""); const [notes, setNotes] = useState(""); const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed"); const [discountValue, setDiscountValue] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const activePresets = presets.filter((preset) => preset.active).sort((a, b) => a.sort_order - b.sort_order || a.value - b.value);
  const filteredClients = useMemo(() => clients.filter((client) => `${client.name} ${client.whatsapp}`.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 12), [clients, clientSearch]);
  const validItems = items.filter((item) => item.serviceId && item.quantity > 0);
  const subtotalAfterItems = items.reduce((sum, item) => { const gross = item.quantity * Number(item.unitPrice || 0); const discount = item.discountType === "percent" ? gross * item.discountValue / 100 : item.discountValue; return sum + Math.max(0, gross - discount); }, 0);
  const generalDiscount = discountType === "percent" ? subtotalAfterItems * discountValue / 100 : discountValue; const total = Math.max(0, subtotalAfterItems - generalDiscount);
  const duration = items.reduce((sum, item) => sum + item.duration * Math.max(1, Math.ceil(item.quantity)), 0); const selectedClient = clients.find((client) => client.id === clientId); const selectedPreset = presets.find((preset) => preset.id === returnPresetId);
  function changeItem(key: string, patch: Partial<ItemDraft>) { setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item)); }
  function pickClient(client: Client) { setClientId(client.id); const nextAddress = addressFromClient(client); setAddress(nextAddress); setWantsAddress(hasAddress(nextAddress)); }
  function chooseService(key: string, serviceId: string) { const service = services.find((entry) => entry.id === serviceId); const option = service?.options?.find((entry) => entry.active) ?? service?.options?.[0]; changeItem(key, { serviceId, optionId: option?.id ?? "", unitPrice: option?.sale_price === null || option?.sale_price === undefined ? "" : String(option.sale_price), unitCost: Number(option?.cost_price ?? 0), duration: option?.duration_minutes ?? 60, width: "", length: "", quantity: 1 }); if (!returnPresetId) setReturnPresetId(option?.return_preset_id ?? service?.default_return_preset_id ?? activePresets.find((preset) => preset.value === 6 && preset.unit === "months")?.id ?? activePresets[0]?.id ?? ""); }
  function chooseOption(key: string, optionId: string) { const option = services.flatMap((service) => service.options ?? []).find((entry) => entry.id === optionId); if (option) { changeItem(key, { optionId, unitPrice: option.sale_price === null ? "" : String(option.sale_price), unitCost: Number(option.cost_price ?? 0), duration: option.duration_minutes, width: "", length: "", quantity: 1 }); if (option.return_preset_id) setReturnPresetId(option.return_preset_id); } else changeItem(key, { optionId: "", unitPrice: "" }); }
  function changeDimension(key: string, dimension: "width" | "length", value: string) { const item = items.find((entry) => entry.key === key); if (!item) return; const next = { ...item, [dimension]: value }; const squareMeters = Number(next.width) * Number(next.length); changeItem(key, { [dimension]: value, quantity: squareMeters > 0 ? Number(squareMeters.toFixed(2)) : 0 }); }
  function validateCurrentStep() { setError(""); if (step === 1) { if (inlineClient) { const phone = digits(newClientPhone); if (newClientName.trim().length < 2) return "Informe o nome do cliente."; if (phone.length < 10 || phone.length > 15) return "Informe um WhatsApp válido, com DDD."; if (duplicate) return `Este WhatsApp já está cadastrado para ${duplicate.name}.`; } else if (!clientId) return "Selecione um cliente para continuar."; } if (step === 2) { if (!validItems.length) return "Inclua pelo menos um serviço na ordem."; if (validItems.some((item) => String(item.unitPrice).trim() === "")) return "Informe o preço de todos os serviços."; if (validItems.some((item) => item.quantity <= 0)) return "Informe a quantidade ou as medidas do serviço."; } if (step === 4) { if (!scheduledDate || !scheduledTime) return "A data e a hora do serviço são obrigatórias."; if (!returnPresetId) return "Escolha quando o sistema deve lembrar do retorno."; } return ""; }
  function nextStep() { const validation = validateCurrentStep(); if (validation) return setError(validation); setStep((current) => Math.min(5, current + 1)); }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (step < 5) return nextStep(); setBusy(true); setError("");
    try {
      let orderClient = selectedClient;
      if (inlineClient) { const phone = digits(newClientPhone); if (await findClientByWhatsapp(phone)) throw new Error("Este WhatsApp já está cadastrado. Volte e escolha o cliente existente."); const { data, error: clientError } = await supabase.from("yan_clients").insert({ name: newClientName.trim(), whatsapp: phone, zipcode: wantsAddress ? digits(address.zipcode) || null : null, street: wantsAddress ? address.street.trim() || null : null, street_number: wantsAddress ? address.street_number.trim() || null : null, complement: wantsAddress ? address.complement.trim() || null : null, neighborhood: wantsAddress ? address.neighborhood.trim() || null : null, city: wantsAddress ? address.city.trim() || "Indaiatuba" : "Indaiatuba", state: wantsAddress ? address.state.trim() || "SP" : "SP", decision_status: "pending", follow_up_at: todayIso() }).select("*").single(); if (clientError) throw clientError; orderClient = data as Client; }
      if (!orderClient) throw new Error("Selecione ou cadastre o cliente."); if (!selectedPreset) throw new Error("Escolha o prazo de retorno.");
      const startsAt = new Date(`${scheduledDate}T${scheduledTime}:00`); if (Number.isNaN(startsAt.getTime())) throw new Error("Informe uma data e hora válidas."); const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      const { data: conflicts, error: conflictError } = await supabase.rpc("yan_check_conflicts", { p_start: startsAt.toISOString(), p_end: endsAt.toISOString(), p_exclude_order_id: null }); if (conflictError) throw conflictError; if (Array.isArray(conflicts) && conflicts.length && !window.confirm(`Existe conflito com ${conflicts.length} atendimento(s) neste horário. Deseja agendar mesmo assim?`)) { setBusy(false); return; }
      const { data: orderData, error: orderError } = await supabase.from("yan_orders").insert({ client_id: orderClient.id, status: "scheduled", scheduled_start: startsAt.toISOString(), scheduled_end: endsAt.toISOString(), zipcode: wantsAddress ? digits(address.zipcode) || null : null, street: wantsAddress ? address.street.trim() || null : null, street_number: wantsAddress ? address.street_number.trim() || null : null, complement: wantsAddress ? address.complement.trim() || null : null, neighborhood: wantsAddress ? address.neighborhood.trim() || null : null, city: wantsAddress ? address.city.trim() || null : null, state: wantsAddress ? address.state.trim() || null : null, discount_type: discountType, discount_value: discountValue, return_value: selectedPreset.value, return_unit: selectedPreset.unit, return_label: selectedPreset.label, notes: notes.trim() || null }).select("id,order_number").single(); if (orderError) throw orderError;
      const itemPayload = validItems.map((item) => { const service = services.find((entry) => entry.id === item.serviceId); const option = service?.options?.find((entry) => entry.id === item.optionId); return { order_id: orderData.id, service_id: item.serviceId, option_id: item.optionId || null, description: `${service?.name ?? "Serviço"}${option ? ` · ${option.name}` : ""}`, pricing_mode: option?.pricing_mode ?? "fixed", quantity: item.quantity, unit_price: Number(item.unitPrice), unit_cost: item.unitCost, discount_type: item.discountType, discount_value: item.discountValue, duration_minutes: item.duration, width_m: item.width ? Number(item.width) : null, length_m: item.length ? Number(item.length) : null }; });
      const { error: itemError } = await supabase.from("yan_order_items").insert(itemPayload); if (itemError) throw itemError;
      await Promise.all([supabase.from("yan_order_events").insert({ order_id: orderData.id, kind: "created", body: `Ordem #${orderData.order_number} criada e agendada.` }), supabase.from("yan_clients").update({ decision_status: "booked", follow_up_at: null }).eq("id", orderClient.id), supabase.from("yan_follow_ups").update({ status: "booked" }).eq("client_id", orderClient.id).in("status", ["pending", "contacted", "snoozed"])]);
      let photoWarning = ""; if (beforeFiles.length) { try { await uploadOrderPhotos(orderData.id, "before", beforeFiles); } catch (caught) { photoWarning = caught instanceof Error ? caught.message : "As fotos não puderam ser salvas."; } }
      await onSaved(); onClose(); if (photoWarning) window.alert(`A ordem foi criada, mas houve um problema com as fotos: ${photoWarning}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível criar a ordem."); }
    finally { setBusy(false); }
  }

  const subtitle = ["Escolha quem será atendido.", "Adicione os serviços e veja o valor na hora.", "Endereço e fotos são opcionais.", "Data, hora e retorno são obrigatórios.", "Confira tudo antes de abrir a ordem."][step - 1];
  return <Modal title="Nova ordem de serviço" subtitle={subtitle} onClose={onClose} wide panelClassName="modal-order"><form className="modal-form order-wizard" onSubmit={submit}><WizardProgress step={step} labels={["Cliente", "Serviços", "Local", "Agenda", "Revisão"]} />
    {step === 1 && <section className="wizard-step"><div className="wizard-heading"><span><UserRound /></span><div><strong>Para quem é o serviço?</strong><p>Escolha um cliente ou cadastre somente nome e WhatsApp.</p></div></div><button type="button" className="inline-mode-switch" onClick={() => { setInlineClient(!inlineClient); setClientId(""); setAddress(blankAddress()); setWantsAddress(false); }}>{inlineClient ? <ChevronLeft /> : <UserPlus />}{inlineClient ? "Escolher cliente cadastrado" : "Cadastrar cliente agora"}</button>{inlineClient ? <div className="inline-client-box"><label className="visual-field"><span>Nome <b className="required-mark">obrigatório</b></span><div className="visual-input"><UserRound /><input autoFocus value={newClientName} onChange={(event) => setNewClientName(event.target.value)} placeholder="Nome completo" /></div></label><WhatsappField value={newClientPhone} onChange={setNewClientPhone} onDuplicate={setDuplicate} /></div> : <div className="client-picker"><div className="visual-input"><UserRound /><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Buscar por nome ou WhatsApp" /></div><div>{filteredClients.map((client) => <button type="button" key={client.id} onClick={() => pickClient(client)} className={clientId === client.id ? "selected" : ""}><span>{client.name.slice(0, 1).toUpperCase()}</span><div><strong>{client.name}</strong><small>{client.whatsapp} · {client.neighborhood || "Sem endereço"}</small></div>{clientId === client.id && <Check />}</button>)}</div></div>}</section>}
    {step === 2 && <section className="wizard-step"><div className="wizard-heading"><span><Sparkles /></span><div><strong>O que será limpo?</strong><p>Adicione quantos serviços precisar. O total aparece em tempo real.</p></div></div><div className="order-items">{items.map((item, index) => { const service = services.find((entry) => entry.id === item.serviceId); const options = service?.options ?? []; const option = options.find((entry) => entry.id === item.optionId); const perSquareMeter = option?.pricing_mode === "per_m2"; const priceMissing = String(item.unitPrice).trim() === ""; return <div className="order-item-editor" key={item.key}><div className="item-editor-head"><strong>Serviço {index + 1}</strong>{items.length > 1 && <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}><Trash2 /> Remover</button>}</div><div className="form-grid two"><label>Serviço <b className="required-mark">obrigatório</b><select value={item.serviceId} onChange={(event) => chooseService(item.key, event.target.value)}><option value="">Selecione</option>{services.filter((entry) => entry.active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>Modelo / categoria <span>opcional</span><select value={item.optionId} onChange={(event) => chooseOption(item.key, event.target.value)}><option value="">Sem modelo</option>{options.filter((entry) => entry.active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.sale_price === null ? " · preço na hora" : ` · ${money(entry.sale_price)}`}</option>)}</select></label></div>{perSquareMeter ? <div className="dimension-box"><div><strong>Medidas do tapete</strong><small>Informe largura e comprimento. O m² é calculado sozinho.</small></div><div className="form-grid dimensions"><label>Largura (m)<input inputMode="decimal" type="number" min="0.01" step="0.01" value={item.width} onChange={(event) => changeDimension(item.key, "width", event.target.value)} placeholder="Ex.: 2,00" /></label><span>×</span><label>Comprimento (m)<input inputMode="decimal" type="number" min="0.01" step="0.01" value={item.length} onChange={(event) => changeDimension(item.key, "length", event.target.value)} placeholder="Ex.: 3,00" /></label><div className="sqm-result"><small>Total</small><strong>{item.quantity || 0} m²</strong></div></div></div> : <label>Quantidade<input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => changeItem(item.key, { quantity: Number(event.target.value) })} /></label>}<div className="form-grid item-values"><label className={priceMissing ? "order-price-field needs-price" : "order-price-field"}><span>Preço {perSquareMeter ? "por m²" : "desta ordem"} {priceMissing && <b>Defina agora</b>}</span><div className="money-field"><i>R$</i><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => changeItem(item.key, { unitPrice: event.target.value })} placeholder="0,00" /></div></label><label><span>Duração (min)</span><input type="number" min="5" value={item.duration} onChange={(event) => changeItem(item.key, { duration: Number(event.target.value) })} /></label><label className="order-discount-field"><span>Desconto do item</span><div className="compound-input"><select value={item.discountType} onChange={(event) => changeItem(item.key, { discountType: event.target.value as "fixed" | "percent" })}><option value="fixed">R$</option><option value="percent">%</option></select><input type="number" min="0" step="0.01" value={item.discountValue} onChange={(event) => changeItem(item.key, { discountValue: Number(event.target.value) })} /></div></label></div></div>; })}</div><button type="button" className="add-service-card" onClick={() => setItems((current) => [...current, newItem()])}><Plus /><span><strong>Adicionar outro serviço</strong><small>Para a mesma ordem e o mesmo horário</small></span></button><div className="live-total"><span><small>Total parcial</small><strong>{money(total)}</strong></span><span><Clock3 />{Math.floor(duration / 60)}h{String(duration % 60).padStart(2, "0")} estimadas</span></div></section>}
    {step === 3 && <section className="wizard-step"><div className="wizard-heading"><span><MapPin /></span><div><strong>Onde será o atendimento?</strong><p>O endereço é opcional. As fotos registram como estava antes.</p></div></div><div className="visual-choice-grid two-options"><button type="button" className={wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(true)}><span><House /></span><strong>Informar endereço</strong><small>Começar pelo CEP</small></button><button type="button" className={!wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(false)}><span><X /></span><strong>Sem endereço</strong><small>Não é obrigatório</small></button></div>{wantsAddress && <div className="wizard-reveal address-reveal"><AddressFields value={address} onChange={setAddress} /></div>}<PhotoPicker files={beforeFiles} onChange={setBeforeFiles} title="Fotos antes do serviço" text="Fotografe o que será limpo ou escolha imagens da galeria." /></section>}
    {step === 4 && <section className="wizard-step"><div className="wizard-heading"><span><CalendarDays /></span><div><strong>Quando será feito?</strong><p>A ordem só pode ser aberta com data e hora definidas.</p></div></div><div className="schedule-card"><div className="quick-date-buttons"><button type="button" className={scheduledDate === todayIso() ? "selected" : ""} onClick={() => setScheduledDate(todayIso())}>Hoje</button><button type="button" className={scheduledDate === tomorrowIso() ? "selected" : ""} onClick={() => setScheduledDate(tomorrowIso())}>Amanhã</button><button type="button" className={scheduledDate === tomorrowIso(7) ? "selected" : ""} onClick={() => setScheduledDate(tomorrowIso(7))}>Daqui 7 dias</button></div><div className="form-grid two schedule-inputs"><label>Data <b className="required-mark">obrigatório</b><div className="visual-input compact"><CalendarDays /><input type="date" required min={todayIso()} value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /></div></label><label>Hora <b className="required-mark">obrigatório</b><div className="visual-input compact"><Clock3 /><input type="time" required value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} /></div></label></div><div className="schedule-result"><CalendarDays /><span><small>Atendimento previsto</small><strong>{scheduledDate && scheduledTime ? dateTime(new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString()) : "Escolha data e hora"}</strong><small>Duração estimada: {Math.floor(duration / 60)}h{String(duration % 60).padStart(2, "0")}</small></span></div></div><div className="return-section"><div><strong>{validItems.length > 1 ? "Retorno geral desta ordem" : "Retorno deste serviço"}</strong><p>{validItems.length > 1 ? "Um único alerta será criado para todos os serviços." : "Escolha quando o sistema deve lembrar de chamar o cliente."}</p></div><div className="return-chip-grid">{activePresets.map((preset) => <button type="button" key={preset.id} className={returnPresetId === preset.id ? "selected" : ""} onClick={() => setReturnPresetId(preset.id)}><Check />{preset.label}</button>)}</div>{!activePresets.length && <div className="form-alert warning"><AlertTriangle />Crie ao menos um prazo de retorno nas Configurações.</div>}</div></section>}
    {step === 5 && <section className="wizard-step review-step"><div className="wizard-heading"><span><Check /></span><div><strong>Revise antes de criar</strong><p>Veja a ordem completa antes de salvar.</p></div></div><div className="order-review-grid"><article><span><UserRound /></span><div><small>Cliente</small><strong>{inlineClient ? newClientName : selectedClient?.name}</strong><p>{inlineClient ? newClientPhone : selectedClient?.whatsapp}</p></div></article><article><span><CalendarDays /></span><div><small>Data e hora</small><strong>{dateTime(new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString())}</strong><p>{Math.floor(duration / 60)}h{String(duration % 60).padStart(2, "0")} de duração</p></div></article><article><span><Sparkles /></span><div><small>Serviços</small><strong>{validItems.length} {validItems.length === 1 ? "serviço" : "serviços"}</strong><p>{validItems.map((item) => services.find((service) => service.id === item.serviceId)?.name).filter(Boolean).join(", ")}</p></div></article><article><span><History /></span><div><small>Próximo retorno</small><strong>{selectedPreset?.label ?? "—"}</strong><p>{validItems.length > 1 ? "Retorno geral" : "Retorno do serviço"}</p></div></article><article><span><MapPin /></span><div><small>Endereço</small><strong>{wantsAddress ? address.neighborhood || address.city || "Informado" : "Não informado"}</strong><p>{wantsAddress ? [address.street, address.street_number].filter(Boolean).join(", ") || "Preenchimento manual" : "Opcional"}</p></div></article><article><span><Camera /></span><div><small>Fotos antes</small><strong>{beforeFiles.length}</strong><p>{beforeFiles.length ? "Serão salvas na ordem" : "Nenhuma foto"}</p></div></article></div><div className="review-finance"><label>Desconto geral<div className="compound-input"><select value={discountType} onChange={(event) => setDiscountType(event.target.value as "fixed" | "percent")}><option value="fixed">R$</option><option value="percent">%</option></select><input type="number" min="0" step="0.01" value={discountValue} onChange={(event) => setDiscountValue(Number(event.target.value))} /></div></label><label>Observações <span>opcional</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Acesso ao local, condição das peças ou combinado com o cliente" /></label><div className="order-total"><span><small>Subtotal</small><strong>{money(subtotalAfterItems)}</strong></span><span><small>Desconto geral</small><strong>− {money(Math.min(subtotalAfterItems, generalDiscount))}</strong></span><span className="grand"><small>Total da ordem</small><strong>{money(total)}</strong></span></div></div></section>}
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions wizard-actions"><button type="button" className="button-secondary" onClick={() => { setError(""); if (step === 1) onClose(); else setStep(step - 1); }}>{step === 1 ? "Cancelar" : <><ArrowLeft /> Voltar</>}</button>{step < 5 ? <button type="button" className="button-admin-primary" onClick={nextStep}>Continuar <ArrowRight /></button> : <button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Criando ordem..." : "Criar e agendar ordem"}</button>}</div>
  </form></Modal>;
}

export function StartDialog({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const beforeCount = order.photos?.filter((photo) => photo.phase === "before").length ?? 0;
  async function start() { setBusy(true); setError(""); try { if (files.length) await uploadOrderPhotos(order.id, "before", files); const { error: updateError } = await supabase.from("yan_orders").update({ status: "in_progress" }).eq("id", order.id); if (updateError) throw updateError; await supabase.from("yan_order_events").insert({ order_id: order.id, kind: "status", body: "Serviço iniciado." }); await onSaved(); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a ordem."); } finally { setBusy(false); } }
  return <Modal title={`Iniciar ordem #${order.order_number}`} subtitle={`${order.client?.name ?? "Cliente"} · ${dateTime(order.scheduled_start)}`} onClose={onClose} panelClassName="modal-client"><div className="modal-form"><div className="start-order-banner"><Camera /><span><strong>Registre o antes</strong><small>{beforeCount ? `${beforeCount} foto(s) já salva(s). Você pode adicionar mais.` : "Tire fotos antes de começar, se quiser."}</small></span></div><PhotoPicker files={files} onChange={setFiles} title="Fotos antes do serviço" text="Elas ficarão guardadas com a ordem para comparação." />{error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions"><button className="button-secondary" onClick={onClose}>Voltar</button><button className="button-admin-primary" disabled={busy} onClick={() => void start()}>{busy ? <Loader2 className="spin" /> : <Check />}{busy ? "Iniciando..." : "Iniciar serviço"}</button></div></div></Modal>;
}

export function CompleteDialog({ order, settings, onClose, onSaved }: { order: Order; settings: YanSettings | null; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [step, setStep] = useState(1); const [files, setFiles] = useState<File[]>([]); const [mode, setMode] = useState<"paid" | "due" | "installments">("paid");
  const [fulfillment, setFulfillment] = useState<"on_site" | "pickup" | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(() => { const date = new Date(`${todayIso()}T12:00:00`); date.setDate(date.getDate() + 1); return date.toISOString().slice(0, 10); });
  const [installments, setInstallments] = useState(2); const [dueDate, setDueDate] = useState(todayIso()); const [method, setMethod] = useState("pix");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [completed, setCompleted] = useState<Order | null>(null); const [photoWarning, setPhotoWarning] = useState("");
  function nextStep() {
    setError("");
    if (step === 1 && !fulfillment) return setError("Informe se o serviço foi feito no local ou se o tapete foi retirado.");
    if (step === 1 && fulfillment === "pickup" && !deliveryDate) return setError("Informe quando o tapete limpo será devolvido.");
    setStep((current) => Math.min(4, current + 1));
  }
  async function finish() {
    setBusy(true); setError("");
    try {
      if (!fulfillment) throw new Error("Informe como o serviço foi realizado.");
      const { error: rpcError } = await supabase.rpc("yan_complete_order_with_fulfillment", { p_order_id: order.id, p_fulfillment_mode: fulfillment, p_delivery_due_date: fulfillment === "pickup" ? deliveryDate : null, p_payment_mode: fulfillment === "pickup" ? "due" : mode, p_installments: fulfillment === "pickup" ? 1 : mode === "installments" ? installments : 1, p_first_due_date: fulfillment === "pickup" ? deliveryDate : dueDate, p_method: method });
      if (rpcError) throw rpcError;
      if (files.length) { try { await uploadOrderPhotos(order.id, "after", files); } catch (caught) { setPhotoWarning(caught instanceof Error ? caught.message : "As fotos finais não puderam ser salvas."); } }
      const { data: freshOrder, error: refreshError } = await supabase.from("yan_orders").select("*, client:yan_clients(*), items:yan_order_items(*, service:yan_services(id,name), option:yan_service_options(id,name)), photos:yan_order_photos(*), receivables:yan_receivables(*), payments:yan_payments(*)").eq("id", order.id).single();
      const finished = refreshError || !freshOrder ? { ...order, status: "completed" as const, completed_at: new Date().toISOString(), fulfillment_mode: fulfillment, delivery_due_date: fulfillment === "pickup" ? deliveryDate : null, delivery_status: fulfillment === "pickup" ? "pending" as const : "not_required" as const } : freshOrder as unknown as Order;
      if (refreshError) setPhotoWarning((current) => current || "O serviço foi concluído, mas os dados do PDF precisarão ser recarregados na agenda.");
      setCompleted(finished); await onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível concluir o serviço."); }
    finally { setBusy(false); }
  }
  async function pdf(share: boolean) { if (!completed) return; setBusy(true); setError(""); try { await deliverOrderPdf(completed, settings, share); } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível gerar o PDF."); } finally { setBusy(false); } }
  if (completed) return <Modal title={completed.delivery_status === "pending" ? "Lavagem concluída" : "Serviço concluído"} subtitle={`Ordem #${order.order_number} atualizada com sucesso.`} onClose={onClose} panelClassName="modal-client"><div className="modal-form completion-success"><div className="success-orbit">{completed.delivery_status === "pending" ? <Truck /> : <Check />}</div><h3>{completed.delivery_status === "pending" ? "Tapete na lista de entregas" : "Pronto para enviar ao cliente"}</h3><p>{completed.delivery_status === "pending" ? `Devolução prevista para ${shortDeliveryDate(completed.delivery_due_date)}. O pagamento ficou pendente para a entrega.` : "O PDF reúne serviços, valores, retorno, garantia e as fotos salvas."}</p><div className="completion-time"><CalendarDays /><span><small>Concluído em</small><strong>{dateTime(completed.completed_at)}</strong></span></div>{photoWarning && <div className="form-alert warning"><AlertTriangle />O serviço foi concluído, mas uma foto falhou: {photoWarning}</div>}{error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="pdf-actions"><button className="button-admin-primary" disabled={busy} onClick={() => void pdf(true)}>{busy ? <Loader2 className="spin" /> : <Send />}Enviar PDF</button><button className="button-secondary" disabled={busy} onClick={() => void pdf(false)}><FileDown />Baixar PDF</button></div><button className="text-action centered" onClick={onClose}>Fechar e voltar às ordens</button></div></Modal>;
  return <Modal title={`Concluir ordem #${order.order_number}`} subtitle={`${order.client?.name ?? "Cliente"} · ${money(order.total)}`} onClose={onClose} panelClassName="modal-complete"><div className="modal-form complete-wizard"><WizardProgress step={step} labels={["Local", "Fotos", "Pagamento", "Finalizar"]} />
    {step === 1 && <section className="wizard-step"><div className="wizard-heading"><span><Truck /></span><div><strong>Onde o serviço foi feito?</strong><p>Isso define se a ordem termina agora ou entra na fila de devolução.</p></div></div><div className="visual-choice-grid two-options"><button type="button" className={fulfillment === "on_site" ? "selected" : ""} onClick={() => setFulfillment("on_site")}><span><House /></span><strong>Limpei no local</strong><small>Sem entrega pendente</small></button><button type="button" className={fulfillment === "pickup" ? "selected" : ""} onClick={() => setFulfillment("pickup")}><span><Truck /></span><strong>Retirei o tapete</strong><small>Vou devolver depois de limpo</small></button></div>{fulfillment === "pickup" && <div className="wizard-reveal delivery-date-reveal"><label>Quando será a devolução? <b className="required-mark">obrigatório</b><div className="visual-input compact"><CalendarDays /><input type="date" required min={todayIso()} value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></div><small className="field-help">A entrega aparecerá na nova página, ordenada pela data mais próxima.</small></label></div>}</section>}
    {step === 2 && <section className="wizard-step"><div className="wizard-heading"><span><Camera /></span><div><strong>Como ficou o serviço?</strong><p>Registre o depois para manter o antes e depois completo.</p></div></div><PhotoPicker files={files} onChange={setFiles} title="Fotos depois do serviço" text="Opcional. Tire fotos agora ou escolha na galeria." /></section>}
    {step === 3 && <section className="wizard-step">{fulfillment === "pickup" ? <><div className="wizard-heading"><span><PackageCheck /></span><div><strong>Pagamento será na entrega</strong><p>Agora ficará pendente somente devolver o tapete e receber o valor.</p></div></div><div className="delivery-payment-note"><Truck /><span><strong>{money(order.total)} a receber</strong><small>Vencimento em {shortDeliveryDate(deliveryDate)}</small></span></div></> : <><div className="wizard-heading"><span><MessageCircle /></span><div><strong>Como será o pagamento?</strong><p>Escolha uma opção para atualizar o financeiro.</p></div></div><div className="choice-cards"><button type="button" className={mode === "paid" ? "selected" : ""} onClick={() => setMode("paid")}><Check /><strong>Recebido agora</strong><small>Entra no caixa hoje</small></button><button type="button" className={mode === "due" ? "selected" : ""} onClick={() => setMode("due")}><strong>Para receber</strong><small>Uma data de vencimento</small></button><button type="button" className={mode === "installments" ? "selected" : ""} onClick={() => setMode("installments")}><strong>Parcelado</strong><small>Divide o valor total</small></button></div>{mode !== "paid" && <div className="form-grid two">{mode === "installments" && <label>Quantidade de parcelas<input type="number" min="2" max="36" value={installments} onChange={(event) => setInstallments(Number(event.target.value))} /></label>}<label>Primeiro vencimento<input type="date" required value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>}{mode === "paid" && <label>Meio de recebimento<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label>}{mode === "installments" && <div className="installment-preview">{installments} parcelas de aproximadamente <strong>{money(order.total / installments)}</strong></div>}</>}</section>}
    {step === 4 && <section className="wizard-step review-step"><div className="wizard-heading"><span><Check /></span><div><strong>Confirmar conclusão</strong><p>{fulfillment === "pickup" ? "A lavagem será concluída e a devolução ficará pendente." : "O horário exato de conclusão será destacado no card."}</p></div></div><div className="finish-summary"><article><small>Cliente</small><strong>{order.client?.name}</strong></article><article><small>Valor</small><strong>{money(order.total)}</strong></article><article><small>Execução</small><strong>{fulfillment === "pickup" ? "Tapete retirado" : "Limpeza no local"}</strong></article><article><small>{fulfillment === "pickup" ? "Devolução" : "Retorno"}</small><strong>{fulfillment === "pickup" ? shortDeliveryDate(deliveryDate) : order.return_label ?? "6 meses"}</strong></article><article><small>Fotos depois</small><strong>{files.length}</strong></article><article><small>Pagamento</small><strong>{fulfillment === "pickup" ? "Na entrega" : mode === "paid" ? "Recebido" : mode === "due" ? "A receber" : `${installments} parcelas`}</strong></article></div><div className="pdf-preview-note"><FileDown /><span><strong>PDF bonito e pronto para o cliente</strong><small>Após concluir, você poderá baixar ou compartilhar diretamente.</small></span></div></section>}
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions wizard-actions"><button type="button" className="button-secondary" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? "Cancelar" : <><ArrowLeft /> Voltar</>}</button>{step < 4 ? <button type="button" className="button-admin-primary" onClick={nextStep}>Continuar <ArrowRight /></button> : <button className="button-admin-primary" disabled={busy} onClick={() => void finish()}>{busy ? <Loader2 className="spin" /> : <Check />}{busy ? "Concluindo..." : fulfillment === "pickup" ? "Concluir lavagem" : "Concluir e gerar PDF"}</button>}</div>
  </div></Modal>;
}

function shortDeliveryDate(value: string | null) {
  if (!value) return "data não informada";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

export function DeliverOrderDialog({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [method, setMethod] = useState("pix"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function deliver() {
    setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc("yan_deliver_order", { p_order_id: order.id, p_method: method });
    if (rpcError) setError(rpcError.message);
    else { await onSaved(); onClose(); }
    setBusy(false);
  }
  return <Modal title="Entregar tapete e receber" subtitle={`Ordem #${order.order_number} · ${order.client?.name ?? "Cliente"}`} onClose={onClose} panelClassName="modal-client"><div className="modal-form"><div className="delivery-confirm-hero"><PackageCheck /><span><strong>{money(order.total)}</strong><small>Ao confirmar, a entrega e o pagamento serão marcados juntos.</small></span></div><label>Meio de recebimento<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label>{error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions"><button className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy} onClick={() => void deliver()}>{busy ? <Loader2 className="spin" /> : <PackageCheck />}{busy ? "Confirmando..." : "Marcar entregue e pago"}</button></div></div></Modal>;
}

export function PaymentDialog({ receivable, onClose, onSaved }: { receivable: Receivable; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [amount, setAmount] = useState(Number(receivable.balance)); const [method, setMethod] = useState("pix"); const [nextDate, setNextDate] = useState(receivable.due_date); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const partial = amount < Number(receivable.balance);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: rpcError } = await supabase.rpc("yan_receive_payment", { p_receivable_id: receivable.id, p_amount: amount, p_method: method, p_next_due_date: partial ? nextDate : null, p_notes: notes.trim() || null }); if (rpcError) setError(rpcError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title="Registrar recebimento" subtitle={`Saldo atual: ${money(receivable.balance)}`} onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Valor recebido<input type="number" min="0.01" max={receivable.balance} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label><label>Meio de pagamento<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label>{partial && <div className="partial-box"><strong>Recebimento parcial</strong><p>Restará {money(Number(receivable.balance) - amount)}. Escolha a nova data para cobrar o saldo.</p><label>Próximo vencimento<input type="date" min={todayIso()} value={nextDate} onChange={(event) => setNextDate(event.target.value)} required /></label></div>}<label>Observação <span>opcional</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Registrando..." : partial ? "Receber parcial" : "Receber total"}</button></div></form></Modal>;
}

export function RefundDialog({ order, available, onClose, onSaved }: { order: Order; available: number; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [amount, setAmount] = useState(available); const [method, setMethod] = useState("pix"); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: rpcError } = await supabase.rpc("yan_refund_order", { p_order_id: order.id, p_amount: amount, p_method: method, p_notes: notes.trim() || null }); if (rpcError) setError(rpcError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title={`Estornar ordem #${order.order_number}`} subtitle={`Disponível para estorno: ${money(available)}`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-alert warning"><AlertTriangle />O estorno será lançado no caixa e ficará registrado no histórico.</div><label>Valor do estorno<input type="number" min="0.01" max={available} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label><label>Forma do estorno<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="pix">Pix</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label><label>Motivo / observação<textarea required value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Descreva por que o valor foi estornado" /></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-danger" disabled={busy}>{busy ? <Loader2 className="spin" /> : "Confirmar estorno"}</button></div></form></Modal>;
}

function defaultPresetId(presets: ReturnPreset[]) { return presets.find((preset) => preset.value === 6 && preset.unit === "months")?.id ?? presets.find((preset) => preset.active)?.id ?? ""; }

export function ServiceDialog({ presets, onClose, onSaved }: { presets: ReturnPreset[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [returnPresetId, setReturnPresetId] = useState(defaultPresetId(presets)); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: insertError } = await supabase.from("yan_services").insert({ name: name.trim(), description: description.trim() || null, default_return_preset_id: returnPresetId || null }); if (insertError) setError(insertError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title="Novo serviço" subtitle="Cadastre o serviço e o alerta de retorno padrão." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Nome<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Cabeceira" /></label><label>Descrição <span>opcional</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Prazo de retorno sugerido <b className="required-mark">obrigatório</b><select required value={returnPresetId} onChange={(event) => setReturnPresetId(event.target.value)}><option value="">Escolha</option>{presets.filter((preset) => preset.active).map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select><small className="field-help">Esse prazo aparece automaticamente na nova ordem e pode ser alterado na hora.</small></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Plus />}Criar serviço</button></div></form></Modal>;
}

export function EditServiceDialog({ service, presets, onClose, onSaved }: { service: Service; presets: ReturnPreset[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(service.name); const [description, setDescription] = useState(service.description ?? ""); const [active, setActive] = useState(service.active); const [returnPresetId, setReturnPresetId] = useState(service.default_return_preset_id ?? defaultPresetId(presets)); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: updateError } = await supabase.from("yan_services").update({ name: name.trim(), description: description.trim() || null, active, default_return_preset_id: returnPresetId || null }).eq("id", service.id); if (updateError) setError(updateError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title={`Editar ${service.name}`} subtitle="Nome, disponibilidade e retorno padrão." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Nome<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Descrição <span>opcional</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Prazo de retorno sugerido<select value={returnPresetId} onChange={(event) => setReturnPresetId(event.target.value)}>{presets.filter((preset) => preset.active).map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label><div className="check-panel"><label className="check-line"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span><strong>Serviço disponível</strong><small>Serviços pausados não aparecem em novas ordens.</small></span></label></div>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}Salvar alterações</button></div></form></Modal>;
}

export function OptionDialog({ service, presets, onClose, onSaved }: { service: Service; presets: ReturnPreset[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(""); const [mode, setMode] = useState<ServiceOption["pricing_mode"]>("fixed"); const [price, setPrice] = useState(""); const [cost, setCost] = useState(""); const [duration, setDuration] = useState(60); const [returnPresetId, setReturnPresetId] = useState(service.default_return_preset_id ?? defaultPresetId(presets)); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const preset = presets.find((entry) => entry.id === returnPresetId); const { error: insertError } = await supabase.from("yan_service_options").insert({ service_id: service.id, name: name.trim(), pricing_mode: mode, sale_price: price === "" ? null : Number(price), cost_price: cost === "" ? null : Number(cost), duration_minutes: duration, return_months: preset?.unit === "months" ? preset.value : 6, return_preset_id: returnPresetId || null }); if (insertError) setError(insertError.message); else { await onSaved(); onClose(); } setBusy(false); }
  return <Modal title={`Novo modelo de ${service.name}`} subtitle="Preço, cálculo, duração e retorno." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Modelo / categoria<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: 3 lugares" /></label><label>Forma de cálculo<select value={mode} onChange={(event) => setMode(event.target.value as ServiceOption["pricing_mode"])}><option value="fixed">Preço fechado</option><option value="per_unit">Por unidade</option><option value="per_m2">Por metro quadrado</option></select></label><div className="form-grid two"><label>Preço de venda <span>opcional</span><input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Definir ao abrir a ordem" /><small className="field-help">Vazio significa preço definido na ordem.</small></label><label>Custo <span>opcional</span><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Não informar" /></label></div><div className="form-grid two"><label>Duração (minutos)<input type="number" min="5" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label><label>Prazo de retorno<select required value={returnPresetId} onChange={(event) => setReturnPresetId(event.target.value)}>{presets.filter((preset) => preset.active).map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label></div>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}Salvar modelo</button></div></form></Modal>;
}

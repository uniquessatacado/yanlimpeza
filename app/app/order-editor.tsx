"use client";

import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, Clock3,
  House, Loader2, MapPin, Pencil, Plus, Save, Sparkles, Trash2, UserPlus, UserRound, X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { dateTime, digits, money, todayIso } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Client, Order, ReturnPreset, Service, ServiceOption } from "../lib/types";
import { findClientByWhatsapp, uploadOrderPhotos, type AddressDraft } from "../lib/workflow";
import { Modal } from "./dialogs";
import { AddressFields, PhotoPicker, revealAboveKeyboard, WhatsappField, WizardProgress } from "./wizard-fields";

type ItemDraft = {
  key: string;
  serviceId: string;
  optionId: string;
  quantity: number;
  unitPrice: string;
  unitCost: number;
  discountType: "fixed" | "percent";
  discountValue: number;
  duration: number;
  width: string;
  length: string;
};

type QuickCatalogDraft = {
  itemKey: string;
  kind: "service" | "option";
  name: string;
  price: string;
  mode: ServiceOption["pricing_mode"];
  duration: number;
};

const draftKey = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ORDER_DRAFT_KEY = "yan:new-order-draft";
type NewOrderDraft = { step?: number; clientId?: string; clientSearch?: string; inlineClient?: boolean; newClientName?: string; newClientPhone?: string; items?: ItemDraft[]; wantsAddress?: boolean; address?: AddressDraft; scheduledDate?: string; scheduledTime?: string; returnPresetId?: string; notes?: string; discountType?: "fixed" | "percent"; discountValue?: number };
type EditOrderDraft = { step: number; clientId: string; items: ItemDraft[]; wantsAddress: boolean; address: AddressDraft; scheduledDate: string; scheduledTime: string; returnPresetId: string; notes: string; discountType: "fixed" | "percent"; discountValue: number };
const editOrderDraftKey = (orderId: string) => `yan:edit-order-draft:${orderId}`;
function readEditOrderDraft(orderId: string) {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.sessionStorage.getItem(editOrderDraftKey(orderId)) ?? "null") as EditOrderDraft | null; }
  catch { window.sessionStorage.removeItem(editOrderDraftKey(orderId)); return null; }
}
const newItem = (): ItemDraft => ({ key: draftKey(), serviceId: "", optionId: "", quantity: 1, unitPrice: "", unitCost: 0, discountType: "fixed", discountValue: 0, duration: 60, width: "", length: "" });
const blankAddress = (): AddressDraft => ({ zipcode: "", street: "", street_number: "", complement: "", neighborhood: "", city: "Indaiatuba", state: "SP" });
const addressFromClient = (client?: Client): AddressDraft => ({ zipcode: client?.zipcode ?? "", street: client?.street ?? "", street_number: client?.street_number ?? "", complement: client?.complement ?? "", neighborhood: client?.neighborhood ?? "", city: client?.city ?? "Indaiatuba", state: client?.state ?? "SP" });
const addressFromOrder = (order: Order): AddressDraft => ({ zipcode: order.zipcode ?? "", street: order.street ?? "", street_number: order.street_number ?? "", complement: order.complement ?? "", neighborhood: order.neighborhood ?? "", city: order.city ?? "Indaiatuba", state: order.state ?? "SP" });
const hasAddress = (address: AddressDraft) => Boolean(address.zipcode || address.street || address.street_number || address.neighborhood || address.complement);
function tomorrowIso(days = 1) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function nextHalfHour() { const date = new Date(Date.now() + 60 * 60_000); date.setMinutes(date.getMinutes() < 30 ? 30 : 0, 0, 0); if (date.getMinutes() === 0) date.setHours(date.getHours() + 1); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
function datePart(value: string | null) { return value ? new Date(value).toLocaleDateString("en-CA") : todayIso(); }
function timePart(value: string | null) { if (!value) return nextHalfHour(); const date = new Date(value); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
function defaultPresetId(presets: ReturnPreset[], service?: Service) { return service?.default_return_preset_id ?? presets.find((preset) => preset.value === 6 && preset.unit === "months")?.id ?? presets.find((preset) => preset.active)?.id ?? ""; }

function useLocalData(clients: Client[], services: Service[]) {
  const [localClients, setLocalClients] = useState<Client[]>(clients);
  const [localServices, setLocalServices] = useState<Service[]>(services);
  return { localClients, setLocalClients, localServices, setLocalServices };
}

function InlineClientEditor({ client, onSaved, onCancel }: { client: Client; onSaved: (client: Client) => void; onCancel: () => void }) {
  const [name, setName] = useState(client.name);
  const [whatsapp, setWhatsapp] = useState(client.whatsapp);
  const [address, setAddress] = useState<AddressDraft>(addressFromClient(client));
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; whatsapp: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (name.trim().length < 2) return setError("Informe o nome do cliente.");
    if (digits(whatsapp).length < 10) return setError("Informe um WhatsApp válido.");
    if (duplicate) return setError(`Este WhatsApp já pertence a ${duplicate.name}.`);
    setBusy(true);
    const payload = {
      name: name.trim(), whatsapp: digits(whatsapp), zipcode: digits(address.zipcode) || null,
      street: address.street.trim() || null, street_number: address.street_number.trim() || null,
      complement: address.complement.trim() || null, neighborhood: address.neighborhood.trim() || null,
      city: address.city.trim() || "Indaiatuba", state: address.state.trim().toUpperCase() || "SP",
    };
    const { data, error: updateError } = await supabase.from("yan_clients").update(payload).eq("id", client.id).select("*").single();
    setBusy(false);
    if (updateError) return setError(updateError.code === "23505" ? "Este WhatsApp já está em outro cadastro." : updateError.message);
    onSaved(data as Client);
  }

  return <div className="wizard-reveal address-reveal">
    <div className="wizard-heading"><span><Pencil /></span><div><strong>Editar cliente sem sair da ordem</strong><p>Nome, WhatsApp e endereço serão atualizados no cadastro.</p></div></div>
    <div className="form-grid two"><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} /></label><WhatsappField value={whatsapp} onChange={setWhatsapp} onDuplicate={setDuplicate} excludeClientId={client.id} /></div>
    <AddressFields value={address} onChange={setAddress} />
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}
    <div className="modal-actions"><button type="button" className="button-secondary" onClick={onCancel}>Cancelar edição</button><button type="button" className="button-admin-primary" disabled={busy || Boolean(duplicate)} onClick={() => void save()}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Salvando..." : "Salvar cliente"}</button></div>
  </div>;
}

function QuickCatalogEditor({ draft, services, presets, onClose, onCreated }: { draft: QuickCatalogDraft; services: Service[]; presets: ReturnPreset[]; onClose: () => void; onCreated: (service: Service, option?: ServiceOption) => void }) {
  const [name, setName] = useState(draft.name);
  const [price, setPrice] = useState(draft.price);
  const [mode, setMode] = useState<ServiceOption["pricing_mode"]>(draft.mode);
  const [duration, setDuration] = useState(draft.duration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const itemService = services.find((service) => service.id === draft.itemKey.split("::")[1]);
  const selectedServiceId = draft.kind === "option" ? draft.itemKey.split("::")[1] : "";
  const selectedService = services.find((service) => service.id === selectedServiceId) ?? itemService;
  const presetId = defaultPresetId(presets, selectedService);
  const preset = presets.find((entry) => entry.id === presetId);

  async function save() {
    setError("");
    if (name.trim().length < 2) return setError(draft.kind === "service" ? "Digite o nome do serviço." : "Digite o nome do modelo.");
    setBusy(true);
    try {
      if (draft.kind === "service") {
        const { data, error: insertError } = await supabase.from("yan_services").insert({ name: name.trim(), description: null, default_return_preset_id: presetId || null }).select("*").single();
        if (insertError) throw insertError;
        onCreated({ ...(data as Service), options: [] });
      } else {
        if (!selectedService) throw new Error("Escolha um serviço antes de criar o modelo.");
        const { data, error: insertError } = await supabase.from("yan_service_options").insert({
          service_id: selectedService.id, name: name.trim(), pricing_mode: mode,
          sale_price: price === "" ? null : Number(price), cost_price: null, duration_minutes: duration,
          return_months: preset?.unit === "months" ? preset.value : 6, return_preset_id: presetId || null,
        }).select("*").single();
        if (insertError) throw insertError;
        onCreated(selectedService, data as ServiceOption);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível cadastrar."); }
    finally { setBusy(false); }
  }

  return <div className="wizard-reveal history-reveal">
    <div className="wizard-heading"><span><Plus /></span><div><strong>{draft.kind === "service" ? "Cadastrar serviço agora" : `Novo modelo de ${selectedService?.name ?? "serviço"}`}</strong><p>Você continua na mesma ordem e o novo cadastro já fica selecionado.</p></div></div>
    <div className="form-grid two"><label>{draft.kind === "service" ? "Nome do serviço" : "Nome do modelo"}<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={draft.kind === "service" ? "Ex.: Poltrona" : "Ex.: Sofá 3 lugares"} /></label>{draft.kind === "option" && <label>Preço padrão <span>opcional</span><div className="money-field"><i>R$</i><input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Pode definir só nesta OS" /></div></label>}</div>
    {draft.kind === "option" && <div className="form-grid two"><label>Forma de cálculo<select value={mode} onChange={(event) => setMode(event.target.value as ServiceOption["pricing_mode"])}><option value="fixed">Preço fechado</option><option value="per_unit">Por unidade</option><option value="per_m2">Por metro quadrado</option></select></label><label>Duração (min)<input type="number" min="5" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label></div>}
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}
    <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Voltar</button><button type="button" className="button-admin-primary" disabled={busy} onClick={() => void save()}>{busy ? <Loader2 className="spin" /> : <Plus />}{busy ? "Salvando..." : draft.kind === "service" ? "Criar serviço" : "Criar modelo"}</button></div>
  </div>;
}

function ItemsEditor({ items, setItems, services, setServices, presets, returnPresetId, setReturnPresetId }: {
  items: ItemDraft[]; setItems: React.Dispatch<React.SetStateAction<ItemDraft[]>>; services: Service[]; setServices: React.Dispatch<React.SetStateAction<Service[]>>;
  presets: ReturnPreset[]; returnPresetId: string; setReturnPresetId: (id: string) => void;
}) {
  const [quick, setQuick] = useState<QuickCatalogDraft | null>(null);
  const activePresets = presets.filter((preset) => preset.active).sort((a, b) => a.sort_order - b.sort_order || a.value - b.value);
  function changeItem(key: string, patch: Partial<ItemDraft>) { setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item)); }
  function chooseService(key: string, serviceId: string) { const service = services.find((entry) => entry.id === serviceId); const option = service?.options?.find((entry) => entry.active) ?? service?.options?.[0]; changeItem(key, { serviceId, optionId: option?.id ?? "", unitPrice: option?.sale_price === null || option?.sale_price === undefined ? "" : String(option.sale_price), unitCost: Number(option?.cost_price ?? 0), duration: option?.duration_minutes ?? 60, width: "", length: "", quantity: 1 }); if (!returnPresetId) setReturnPresetId(option?.return_preset_id ?? defaultPresetId(presets, service)); }
  function chooseOption(key: string, optionId: string) { const option = services.flatMap((service) => service.options ?? []).find((entry) => entry.id === optionId); if (option) { changeItem(key, { optionId, unitPrice: option.sale_price === null ? "" : String(option.sale_price), unitCost: Number(option.cost_price ?? 0), duration: option.duration_minutes, width: "", length: "", quantity: 1 }); if (option.return_preset_id) setReturnPresetId(option.return_preset_id); } else changeItem(key, { optionId: "", unitPrice: "" }); }
  function changeDimension(key: string, dimension: "width" | "length", value: string) { const item = items.find((entry) => entry.key === key); if (!item) return; const next = { ...item, [dimension]: value }; const squareMeters = Number(next.width) * Number(next.length); changeItem(key, { [dimension]: value, quantity: squareMeters > 0 ? Number(squareMeters.toFixed(2)) : 0 }); }
  function created(itemKey: string, service: Service, option?: ServiceOption) {
    setServices((current) => {
      const found = current.find((entry) => entry.id === service.id);
      if (!found) return [...current, service];
      if (!option) return current;
      return current.map((entry) => entry.id === service.id ? { ...entry, options: [...(entry.options ?? []), option] } : entry);
    });
    if (option) changeItem(itemKey, { serviceId: service.id, optionId: option.id, unitPrice: option.sale_price === null ? "" : String(option.sale_price), unitCost: Number(option.cost_price ?? 0), duration: option.duration_minutes, quantity: 1, width: "", length: "" });
    else chooseService(itemKey, service.id);
    setQuick(null);
  }

  return <>
    <div className="order-items">{items.map((item, index) => { const service = services.find((entry) => entry.id === item.serviceId); const options = service?.options ?? []; const option = options.find((entry) => entry.id === item.optionId); const perSquareMeter = option?.pricing_mode === "per_m2"; const priceMissing = String(item.unitPrice).trim() === ""; return <div className="order-item-editor" key={item.key}>
      <div className="item-editor-head"><strong>Serviço {index + 1}</strong>{items.length > 1 && <button type="button" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}><Trash2 /> Remover</button>}</div>
      <div className="form-grid two"><label>Serviço <b className="required-mark">obrigatório</b><select value={item.serviceId} onChange={(event) => { const value = event.target.value; if (value === "__new_service__") { setQuick({ itemKey: item.key, kind: "service", name: "", price: "", mode: "fixed", duration: 60 }); return; } chooseService(item.key, value); }}><option value="">Selecione</option><option value="__new_service__">＋ Cadastrar novo serviço</option>{services.filter((entry) => entry.active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label>Modelo / categoria <span>opcional</span><select value={item.optionId} onChange={(event) => { const value = event.target.value; if (value === "__new_option__") { if (item.serviceId) setQuick({ itemKey: `${item.key}::${item.serviceId}`, kind: "option", name: "", price: item.unitPrice, mode: "fixed", duration: item.duration }); return; } chooseOption(item.key, value); }}><option value="">Sem modelo</option>{item.serviceId && <option value="__new_option__">＋ Cadastrar novo modelo / categoria</option>}{options.filter((entry) => entry.active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.sale_price === null ? " · preço na hora" : ` · ${money(entry.sale_price)}`}</option>)}</select></label></div>
      <div className="catalog-quick-actions" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
        <button type="button" className="button-secondary" style={{ minHeight: 46, color: "#0759b7", background: "#eaf5ff", borderColor: "#83bff0", fontWeight: 900 }} onClick={() => setQuick({ itemKey: item.key, kind: "service", name: "", price: "", mode: "fixed", duration: 60 })}><Plus /> + Novo serviço</button>
        <button type="button" className="button-secondary" disabled={!item.serviceId} style={{ minHeight: 46, color: "#0759b7", background: "#eaf5ff", borderColor: "#83bff0", fontWeight: 900, opacity: item.serviceId ? 1 : .55 }} onClick={() => item.serviceId && setQuick({ itemKey: `${item.key}::${item.serviceId}`, kind: "option", name: "", price: item.unitPrice, mode: "fixed", duration: item.duration })}><Plus /> {item.serviceId ? "+ Novo modelo / categoria" : "Escolha o serviço primeiro"}</button>
      </div>
      {quick && (quick.itemKey === item.key || quick.itemKey.startsWith(`${item.key}::`)) && <QuickCatalogEditor draft={quick} services={services} presets={presets} onClose={() => setQuick(null)} onCreated={(createdService, createdOption) => created(item.key, createdService, createdOption)} />}
      {perSquareMeter ? <div className="dimension-box"><div><strong>Medidas</strong><small>Informe largura e comprimento para calcular o m².</small></div><div className="form-grid dimensions"><label>Largura (m)<input inputMode="decimal" type="number" min="0.01" step="0.01" value={item.width} onChange={(event) => changeDimension(item.key, "width", event.target.value)} /></label><span>×</span><label>Comprimento (m)<input inputMode="decimal" type="number" min="0.01" step="0.01" value={item.length} onChange={(event) => changeDimension(item.key, "length", event.target.value)} /></label><div className="sqm-result"><small>Total</small><strong>{item.quantity || 0} m²</strong></div></div></div> : <label className="quantity-field">Quantidade<input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => changeItem(item.key, { quantity: Number(event.target.value) })} /></label>}
      <div className="form-grid item-values"><label className={priceMissing ? "order-price-field needs-price" : "order-price-field"}><span>Preço {perSquareMeter ? "por m²" : "desta ordem"} {priceMissing && <b>Defina agora</b>}</span><div className="money-field"><i>R$</i><input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => changeItem(item.key, { unitPrice: event.target.value })} placeholder="Digite o valor" /></div><small className="field-help">Valor cobrado neste serviço.</small></label><label className="duration-field"><span>Duração</span><input type="number" min="5" value={item.duration} onChange={(event) => changeItem(item.key, { duration: Number(event.target.value) })} /><small>minutos</small></label><label className="order-discount-field"><span>Desconto do item</span><div className="compound-input"><select value={item.discountType} onChange={(event) => changeItem(item.key, { discountType: event.target.value as "fixed" | "percent" })}><option value="fixed">R$</option><option value="percent">%</option></select><input type="number" min="0" step="0.01" value={item.discountValue || ""} onChange={(event) => changeItem(item.key, { discountValue: Number(event.target.value) })} placeholder="0" /></div></label></div>
    </div>; })}</div>
    <button type="button" className="add-service-card" onClick={() => setItems((current) => [...current, newItem()])}><Plus /><span><strong>Adicionar outro serviço</strong><small>Para a mesma ordem</small></span></button>
    {!activePresets.length && <div className="form-alert warning"><AlertTriangle />Crie ao menos um prazo de retorno nas Configurações.</div>}
  </>;
}

function itemTotals(items: ItemDraft[], discountType: "fixed" | "percent", discountValue: number) {
  const subtotal = items.reduce((sum, item) => { const gross = item.quantity * Number(item.unitPrice || 0); const discount = item.discountType === "percent" ? gross * item.discountValue / 100 : item.discountValue; return sum + Math.max(0, gross - discount); }, 0);
  const general = discountType === "percent" ? subtotal * discountValue / 100 : discountValue;
  const total = Math.max(0, subtotal - general);
  const duration = items.reduce((sum, item) => sum + item.duration * Math.max(1, Math.ceil(item.quantity)), 0);
  return { subtotal, general, total, duration };
}

function payloadForItems(items: ItemDraft[], services: Service[], orderId: string) {
  return items.filter((item) => item.serviceId && item.quantity > 0).map((item) => {
    const service = services.find((entry) => entry.id === item.serviceId);
    const option = service?.options?.find((entry) => entry.id === item.optionId);
    return { order_id: orderId, service_id: item.serviceId, option_id: item.optionId || null, description: `${service?.name ?? "Serviço"}${option ? ` · ${option.name}` : ""}`, pricing_mode: option?.pricing_mode ?? "fixed", quantity: item.quantity, unit_price: Number(item.unitPrice), unit_cost: item.unitCost, discount_type: item.discountType, discount_value: item.discountValue, duration_minutes: item.duration, width_m: item.width ? Number(item.width) : null, length_m: item.length ? Number(item.length) : null };
  });
}

function ScheduleConflictDialog({ count, onChange, onContinue }: { count: number; onChange: () => void; onContinue: () => void }) {
  return <Modal title="Conflito de agenda" subtitle="Já existe atendimento neste período." onClose={onChange} panelClassName="modal-conflict"><div className="modal-form"><div className="conflict-warning"><span><AlertTriangle /></span><div><strong>{count} atendimento{count > 1 ? "s coincidem" : " coincide"} com este horário</strong><p>Você pode voltar para escolher outra data e hora ou manter o encaixe mesmo assim.</p></div></div><div className="modal-actions"><button type="button" className="button-secondary" onClick={onChange}><CalendarDays /> Mudar data e hora</button><button type="button" className="button-admin-primary" onClick={onContinue}><Check /> Continuar mesmo assim</button></div></div></Modal>;
}

export function OrderDialog({ clients, services, presets, defaultClientId, initialDate, initialTime, onClose, onSaved }: { clients: Client[]; services: Service[]; presets: ReturnPreset[]; defaultClientId?: string; initialDate?: string; initialTime?: string; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { localClients, setLocalClients, localServices, setLocalServices } = useLocalData(clients, services);
  const [savedDraft] = useState<NewOrderDraft | null>(() => { if (defaultClientId || initialDate || initialTime || typeof window === "undefined") return null; try { const raw = window.sessionStorage.getItem(ORDER_DRAFT_KEY); return raw ? JSON.parse(raw) as NewOrderDraft : null; } catch { return null; } });
  const restoredClientId = savedDraft?.clientId ?? defaultClientId ?? ""; const initialClient = localClients.find((client) => client.id === restoredClientId);
  const [step, setStep] = useState(savedDraft?.step ?? 1); const [clientId, setClientId] = useState(restoredClientId); const [clientSearch, setClientSearch] = useState(savedDraft?.clientSearch ?? "");
  const [inlineClient, setInlineClient] = useState(savedDraft?.inlineClient ?? false); const [newClientName, setNewClientName] = useState(savedDraft?.newClientName ?? ""); const [newClientPhone, setNewClientPhone] = useState(savedDraft?.newClientPhone ?? ""); const [duplicate, setDuplicate] = useState<{ id: string; name: string; whatsapp: string } | null>(null);
  const [editingClient, setEditingClient] = useState(false); const [items, setItems] = useState<ItemDraft[]>(savedDraft?.items?.length ? savedDraft.items : [newItem()]);
  const initialAddress = savedDraft?.address ?? addressFromClient(initialClient); const [wantsAddress, setWantsAddress] = useState(savedDraft?.wantsAddress ?? (initialClient ? hasAddress(initialAddress) : false)); const [address, setAddress] = useState<AddressDraft>(initialAddress);
  const [beforeFiles, setBeforeFiles] = useState<File[]>([]); const [scheduledDate, setScheduledDate] = useState(savedDraft?.scheduledDate ?? initialDate ?? todayIso()); const [scheduledTime, setScheduledTime] = useState(savedDraft?.scheduledTime ?? initialTime ?? nextHalfHour());
  const [returnPresetId, setReturnPresetId] = useState(savedDraft?.returnPresetId ?? ""); const [notes, setNotes] = useState(savedDraft?.notes ?? ""); const [discountType, setDiscountType] = useState<"fixed" | "percent">(savedDraft?.discountType ?? "fixed"); const [discountValue, setDiscountValue] = useState(savedDraft?.discountValue ?? 0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [conflictCount, setConflictCount] = useState(0); const formRef = useRef<HTMLFormElement>(null); const bypassConflict = useRef(false);
  const filteredClients = useMemo(() => localClients.filter((client) => `${client.name} ${client.whatsapp}`.toLowerCase().includes(clientSearch.toLowerCase())).slice(0, 12), [localClients, clientSearch]);
  const selectedClient = localClients.find((client) => client.id === clientId); const selectedPreset = presets.find((preset) => preset.id === returnPresetId); const validItems = items.filter((item) => item.serviceId && item.quantity > 0); const totals = itemTotals(items, discountType, discountValue);
  useEffect(() => {
    window.sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify({ step, clientId, clientSearch, inlineClient, newClientName, newClientPhone, items, wantsAddress, address, scheduledDate, scheduledTime, returnPresetId, notes, discountType, discountValue }));
  }, [address, clientId, clientSearch, discountType, discountValue, inlineClient, items, newClientName, newClientPhone, notes, returnPresetId, scheduledDate, scheduledTime, step, wantsAddress]);
  function pickClient(client: Client) { setClientId(client.id); const nextAddress = addressFromClient(client); setAddress(nextAddress); setWantsAddress(hasAddress(nextAddress)); setEditingClient(false); }
  function validateCurrentStep() { setError(""); if (step === 1) { if (inlineClient) { const phone = digits(newClientPhone); if (newClientName.trim().length < 2) return "Informe o nome do cliente."; if (phone.length < 10 || phone.length > 15) return "Informe um WhatsApp válido, com DDD."; if (duplicate) return `Este WhatsApp já está cadastrado para ${duplicate.name}.`; } else if (!clientId) return "Selecione um cliente para continuar."; } if (step === 2) { if (!validItems.length) return "Inclua pelo menos um serviço na ordem."; if (validItems.some((item) => String(item.unitPrice).trim() === "")) return "Informe o preço de todos os serviços."; } if (step === 4) { if (!scheduledDate || !scheduledTime) return "A data e a hora são obrigatórias."; if (!returnPresetId) return "Escolha o prazo de retorno."; } return ""; }
  function nextStep() { const validation = validateCurrentStep(); if (validation) return setError(validation); setStep((current) => Math.min(5, current + 1)); }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (step < 5) return nextStep(); setBusy(true); setError("");
    try {
      let orderClient = selectedClient;
      if (inlineClient) { const phone = digits(newClientPhone); if (await findClientByWhatsapp(phone)) throw new Error("Este WhatsApp já está cadastrado. Volte e escolha o cliente existente."); const { data, error: clientError } = await supabase.from("yan_clients").insert({ name: newClientName.trim(), whatsapp: phone, zipcode: wantsAddress ? digits(address.zipcode) || null : null, street: wantsAddress ? address.street.trim() || null : null, street_number: wantsAddress ? address.street_number.trim() || null : null, complement: wantsAddress ? address.complement.trim() || null : null, neighborhood: wantsAddress ? address.neighborhood.trim() || null : null, city: wantsAddress ? address.city.trim() || "Indaiatuba" : "Indaiatuba", state: wantsAddress ? address.state.trim() || "SP" : "SP", decision_status: "pending", follow_up_at: todayIso() }).select("*").single(); if (clientError) throw clientError; orderClient = data as Client; }
      if (!orderClient) throw new Error("Selecione ou cadastre o cliente."); if (!selectedPreset) throw new Error("Escolha o prazo de retorno.");
      const startsAt = new Date(`${scheduledDate}T${scheduledTime}:00`); const endsAt = new Date(startsAt.getTime() + totals.duration * 60_000);
      const { data: conflicts, error: conflictError } = await supabase.rpc("yan_check_conflicts", { p_start: startsAt.toISOString(), p_end: endsAt.toISOString(), p_exclude_order_id: null }); if (conflictError) throw conflictError; const canBypass = bypassConflict.current; bypassConflict.current = false; if (Array.isArray(conflicts) && conflicts.length && !canBypass) { setConflictCount(conflicts.length); setBusy(false); return; }
      const { data: orderData, error: orderError } = await supabase.from("yan_orders").insert({ client_id: orderClient.id, status: "scheduled", scheduled_start: startsAt.toISOString(), scheduled_end: endsAt.toISOString(), zipcode: wantsAddress ? digits(address.zipcode) || null : null, street: wantsAddress ? address.street.trim() || null : null, street_number: wantsAddress ? address.street_number.trim() || null : null, complement: wantsAddress ? address.complement.trim() || null : null, neighborhood: wantsAddress ? address.neighborhood.trim() || null : null, city: wantsAddress ? address.city.trim() || null : null, state: wantsAddress ? address.state.trim() || null : null, discount_type: discountType, discount_value: discountValue, return_value: selectedPreset.value, return_unit: selectedPreset.unit, return_label: selectedPreset.label, notes: notes.trim() || null }).select("id,order_number").single(); if (orderError) throw orderError;
      const { error: itemError } = await supabase.from("yan_order_items").insert(payloadForItems(validItems, localServices, orderData.id)); if (itemError) throw itemError;
      await Promise.all([supabase.from("yan_order_events").insert({ order_id: orderData.id, kind: "created", body: `Ordem #${orderData.order_number} criada e agendada.` }), supabase.from("yan_clients").update({ decision_status: "booked", follow_up_at: null }).eq("id", orderClient.id), supabase.from("yan_follow_ups").update({ status: "booked" }).eq("client_id", orderClient.id).in("status", ["pending", "contacted", "snoozed"])]);
      let photoWarning = ""; if (beforeFiles.length) { try { await uploadOrderPhotos(orderData.id, "before", beforeFiles); } catch (caught) { photoWarning = caught instanceof Error ? caught.message : "As fotos não puderam ser salvas."; } }
      window.sessionStorage.removeItem(ORDER_DRAFT_KEY); await onSaved(); onClose(); if (photoWarning) window.alert(`A ordem foi criada, mas houve um problema com as fotos: ${photoWarning}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível criar a ordem."); }
    finally { setBusy(false); }
  }

  const subtitle = ["Escolha ou edite o cliente.", "Cadastre serviços/modelos e defina o preço da OS.", "Endereço e fotos são opcionais.", "Defina data, hora e retorno.", "Confira tudo antes de salvar."][step - 1];
  return <><Modal title="Nova ordem de serviço" subtitle={subtitle} onClose={onClose} wide panelClassName="modal-order"><form ref={formRef} className="modal-form order-wizard" onSubmit={submit}><WizardProgress step={step} labels={["Cliente", "Serviços", "Local", "Agenda", "Revisão"]} />
    {step === 1 && <section className="wizard-step"><div className="wizard-heading"><span><UserRound /></span><div><strong>Para quem é o serviço?</strong><p>Escolha um cliente, edite os dados ou cadastre um novo.</p></div></div><button type="button" className="inline-mode-switch" onClick={() => { setInlineClient(!inlineClient); setClientId(""); setAddress(blankAddress()); setWantsAddress(false); setEditingClient(false); }}>{inlineClient ? <ChevronLeft /> : <UserPlus />}{inlineClient ? "Escolher cliente cadastrado" : "Cadastrar cliente agora"}</button>{inlineClient ? <div className="inline-client-box"><label className="visual-field"><span>Nome <b className="required-mark">obrigatório</b></span><div className="visual-input"><UserRound /><input autoFocus value={newClientName} onChange={(event) => setNewClientName(event.target.value)} /></div></label><WhatsappField value={newClientPhone} onChange={setNewClientPhone} onDuplicate={setDuplicate} /></div> : <><div className="client-picker"><div className="visual-input"><UserRound /><input value={clientSearch} onFocus={(event) => revealAboveKeyboard(event.currentTarget)} onChange={(event) => { setClientSearch(event.target.value); revealAboveKeyboard(event.currentTarget); }} placeholder="Buscar por nome ou WhatsApp" /></div><div>{filteredClients.map((client) => <button type="button" key={client.id} onClick={() => pickClient(client)} className={clientId === client.id ? "selected" : ""}><span>{client.name.slice(0, 1).toUpperCase()}</span><div><strong>{client.name}</strong><small>{client.whatsapp} · {client.neighborhood || "Sem endereço"}</small></div>{clientId === client.id && <Check />}</button>)}</div></div>{selectedClient && !editingClient && <button type="button" className="inline-mode-switch" onClick={() => setEditingClient(true)}><Pencil /> Editar dados de {selectedClient.name}</button>}{selectedClient && editingClient && <InlineClientEditor client={selectedClient} onCancel={() => setEditingClient(false)} onSaved={(updated) => { setLocalClients((current) => current.map((entry) => entry.id === updated.id ? updated : entry)); setAddress(addressFromClient(updated)); setWantsAddress(hasAddress(addressFromClient(updated))); setEditingClient(false); }} />}</>}</section>}
    {step === 2 && <section className="wizard-step"><div className="wizard-heading"><span><Sparkles /></span><div><strong>O que será limpo?</strong><p>Se o serviço ou modelo não existir, cadastre aqui mesmo. O preço da OS é sempre editável.</p></div></div><ItemsEditor items={items} setItems={setItems} services={localServices} setServices={setLocalServices} presets={presets} returnPresetId={returnPresetId} setReturnPresetId={setReturnPresetId} /><div className="live-total"><span><small>Total parcial</small><strong>{money(totals.total)}</strong></span><span><Clock3 />{Math.floor(totals.duration / 60)}h{String(totals.duration % 60).padStart(2, "0")} estimadas</span></div></section>}
    {step === 3 && <section className="wizard-step"><div className="wizard-heading"><span><MapPin /></span><div><strong>Onde será o atendimento?</strong><p>O endereço desta OS pode ser diferente do endereço cadastrado do cliente.</p></div></div><div className="visual-choice-grid two-options"><button type="button" className={wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(true)}><span><House /></span><strong>Informar endereço</strong><small>Editar livremente</small></button><button type="button" className={!wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(false)}><span><X /></span><strong>Sem endereço</strong><small>Não é obrigatório</small></button></div>{wantsAddress && <div className="wizard-reveal address-reveal"><AddressFields value={address} onChange={setAddress} /></div>}<PhotoPicker files={beforeFiles} onChange={setBeforeFiles} title="Fotos antes do serviço" text="Fotografe o que será limpo ou escolha imagens da galeria." /></section>}
    {step === 4 && <section className="wizard-step"><div className="wizard-heading"><span><CalendarDays /></span><div><strong>Quando será feito?</strong><p>Data, hora e retorno podem ser definidos por ordem.</p></div></div><div className="schedule-card"><div className="quick-date-buttons"><button type="button" className={scheduledDate === todayIso() ? "selected" : ""} onClick={() => setScheduledDate(todayIso())}>Hoje</button><button type="button" className={scheduledDate === tomorrowIso() ? "selected" : ""} onClick={() => setScheduledDate(tomorrowIso())}>Amanhã</button><button type="button" className={scheduledDate === tomorrowIso(7) ? "selected" : ""} onClick={() => setScheduledDate(tomorrowIso(7))}>Daqui 7 dias</button></div><div className="form-grid two"><label>Data<input type="date" required value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /></label><label>Hora<input type="time" required value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} /></label></div></div><div className="return-section"><div><strong>Prazo de retorno</strong><p>Escolha quando lembrar de chamar o cliente novamente.</p></div><div className="return-chip-grid">{presets.filter((preset) => preset.active).map((preset) => <button type="button" key={preset.id} className={returnPresetId === preset.id ? "selected" : ""} onClick={() => setReturnPresetId(preset.id)}><Check />{preset.label}</button>)}</div></div></section>}
    {step === 5 && <section className="wizard-step review-step"><div className="wizard-heading"><span><Check /></span><div><strong>Revise antes de criar</strong><p>Você ainda pode voltar e alterar qualquer informação.</p></div></div><div className="order-review-grid"><article><span><UserRound /></span><div><small>Cliente</small><strong>{inlineClient ? newClientName : selectedClient?.name}</strong><p>{inlineClient ? newClientPhone : selectedClient?.whatsapp}</p></div></article><article><span><CalendarDays /></span><div><small>Data e hora</small><strong>{dateTime(new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString())}</strong><p>{Math.floor(totals.duration / 60)}h{String(totals.duration % 60).padStart(2, "0")} de duração</p></div></article><article><span><Sparkles /></span><div><small>Serviços</small><strong>{validItems.length}</strong><p>{validItems.map((item) => localServices.find((service) => service.id === item.serviceId)?.name).filter(Boolean).join(", ")}</p></div></article><article><span><MapPin /></span><div><small>Endereço</small><strong>{wantsAddress ? address.neighborhood || address.city || "Informado" : "Não informado"}</strong><p>{wantsAddress ? [address.street, address.street_number].filter(Boolean).join(", ") : "Opcional"}</p></div></article></div><div className="review-finance"><label>Desconto geral<div className="compound-input"><select value={discountType} onChange={(event) => setDiscountType(event.target.value as "fixed" | "percent")}><option value="fixed">R$</option><option value="percent">%</option></select><input type="number" min="0" step="0.01" value={discountValue || ""} onChange={(event) => setDiscountValue(Number(event.target.value))} placeholder="Sem desconto" /></div></label><label>Observações <span>opcional</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="order-total"><span><small>Subtotal</small><strong>{money(totals.subtotal)}</strong></span><span><small>Desconto geral</small><strong>− {money(Math.min(totals.subtotal, totals.general))}</strong></span><span className="grand"><small>Total da ordem</small><strong>{money(totals.total)}</strong></span></div></div></section>}
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions wizard-actions"><button type="button" className="button-secondary" onClick={() => { setError(""); if (step === 1) onClose(); else setStep(step - 1); }}>{step === 1 ? "Cancelar" : <><ArrowLeft /> Voltar</>}</button>{step < 5 ? <button type="button" className="button-admin-primary" onClick={nextStep}>Continuar <ArrowRight /></button> : <button className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Criando ordem..." : "Criar e agendar ordem"}</button>}</div>
  </form></Modal>{conflictCount > 0 && <ScheduleConflictDialog count={conflictCount} onChange={() => { setConflictCount(0); setStep(4); }} onContinue={() => { setConflictCount(0); bypassConflict.current = true; window.setTimeout(() => formRef.current?.requestSubmit(), 0); }} />}</>;
}

export function EditOrderDialog({ order, clients, services, presets, onClose, onSaved }: { order: Order; clients: Client[]; services: Service[]; presets: ReturnPreset[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { localClients, setLocalClients, localServices, setLocalServices } = useLocalData(clients, services);
  const [savedDraft] = useState<EditOrderDraft | null>(() => readEditOrderDraft(order.id));
  const orderItems: ItemDraft[] = (order.items ?? []).map((item) => ({ key: item.id || draftKey(), serviceId: item.service_id, optionId: item.option_id ?? "", quantity: Number(item.quantity), unitPrice: String(item.unit_price), unitCost: Number(item.unit_cost), discountType: item.discount_type, discountValue: Number(item.discount_value), duration: Number(item.duration_minutes), width: item.width_m === null ? "" : String(item.width_m), length: item.length_m === null ? "" : String(item.length_m) }));
  const initialAddress = savedDraft?.address ?? addressFromOrder(order); const matchingPreset = presets.find((preset) => preset.value === order.return_value && preset.unit === order.return_unit);
  const [step, setStep] = useState(() => Math.min(3, Math.max(1, savedDraft?.step ?? 1))); const [clientId, setClientId] = useState(savedDraft?.clientId ?? order.client_id); const [editingClient, setEditingClient] = useState(false);
  const [items, setItems] = useState<ItemDraft[]>(savedDraft?.items?.length ? savedDraft.items : orderItems.length ? orderItems : [newItem()]);
  const [wantsAddress, setWantsAddress] = useState(savedDraft?.wantsAddress ?? hasAddress(initialAddress)); const [address, setAddress] = useState<AddressDraft>(initialAddress);
  const [scheduledDate, setScheduledDate] = useState(savedDraft?.scheduledDate ?? datePart(order.scheduled_start)); const [scheduledTime, setScheduledTime] = useState(savedDraft?.scheduledTime ?? timePart(order.scheduled_start));
  const [returnPresetId, setReturnPresetId] = useState(savedDraft?.returnPresetId ?? matchingPreset?.id ?? defaultPresetId(presets));
  const [notes, setNotes] = useState(savedDraft?.notes ?? order.notes ?? ""); const [discountType, setDiscountType] = useState<"fixed" | "percent">(savedDraft?.discountType ?? order.discount_type); const [discountValue, setDiscountValue] = useState(savedDraft?.discountValue ?? Number(order.discount_value));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [conflictCount, setConflictCount] = useState(0); const formRef = useRef<HTMLFormElement>(null); const bypassConflict = useRef(false); const selectedClient = localClients.find((client) => client.id === clientId); const selectedPreset = presets.find((preset) => preset.id === returnPresetId); const validItems = items.filter((item) => item.serviceId && item.quantity > 0); const totals = itemTotals(items, discountType, discountValue);

  useEffect(() => {
    const draft: EditOrderDraft = { step, clientId, items, wantsAddress, address, scheduledDate, scheduledTime, returnPresetId, notes, discountType, discountValue };
    window.sessionStorage.setItem(editOrderDraftKey(order.id), JSON.stringify(draft));
  }, [address, clientId, discountType, discountValue, items, notes, order.id, returnPresetId, scheduledDate, scheduledTime, step, wantsAddress]);

  function discardAndClose() { window.sessionStorage.removeItem(editOrderDraftKey(order.id)); onClose(); }

  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!selectedClient) return setError("Selecione o cliente.");
    if (!validItems.length) return setError("Inclua pelo menos um serviço.");
    if (validItems.some((item) => String(item.unitPrice).trim() === "")) return setError("Informe o preço de todos os serviços.");
    if (!selectedPreset) return setError("Escolha o prazo de retorno.");
    setBusy(true);
    try {
      const startsAt = new Date(`${scheduledDate}T${scheduledTime}:00`); const endsAt = new Date(startsAt.getTime() + totals.duration * 60_000);
      const { data: conflicts, error: conflictError } = await supabase.rpc("yan_check_conflicts", { p_start: startsAt.toISOString(), p_end: endsAt.toISOString(), p_exclude_order_id: order.id }); if (conflictError) throw conflictError; const canBypass = bypassConflict.current; bypassConflict.current = false; if (Array.isArray(conflicts) && conflicts.length && !canBypass) { setConflictCount(conflicts.length); setBusy(false); return; }
      const { error: orderError } = await supabase.from("yan_orders").update({ client_id: selectedClient.id, scheduled_start: startsAt.toISOString(), scheduled_end: endsAt.toISOString(), zipcode: wantsAddress ? digits(address.zipcode) || null : null, street: wantsAddress ? address.street.trim() || null : null, street_number: wantsAddress ? address.street_number.trim() || null : null, complement: wantsAddress ? address.complement.trim() || null : null, neighborhood: wantsAddress ? address.neighborhood.trim() || null : null, city: wantsAddress ? address.city.trim() || null : null, state: wantsAddress ? address.state.trim() || null : null, discount_type: discountType, discount_value: discountValue, return_value: selectedPreset.value, return_unit: selectedPreset.unit, return_label: selectedPreset.label, notes: notes.trim() || null }).eq("id", order.id); if (orderError) throw orderError;
      const { error: deleteError } = await supabase.from("yan_order_items").delete().eq("order_id", order.id); if (deleteError) throw deleteError;
      const { error: itemError } = await supabase.from("yan_order_items").insert(payloadForItems(validItems, localServices, order.id)); if (itemError) throw itemError;
      await supabase.from("yan_order_events").insert({ order_id: order.id, kind: "updated", body: "Ordem editada: cliente, serviços, valores, endereço e/ou agenda atualizados." });
      window.sessionStorage.removeItem(editOrderDraftKey(order.id)); await onSaved(); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar a ordem."); }
    finally { setBusy(false); }
  }

  return <><Modal title={`Editar ordem #${order.order_number}`} subtitle="Altere cliente, serviços, modelos, preços, endereço, data, hora e observações." onClose={discardAndClose} closeOnBackdrop={false} wide panelClassName="modal-order"><form ref={formRef} className="modal-form order-wizard" onSubmit={save}><WizardProgress step={step} labels={["Cliente", "Serviços", "Local e agenda"]} />
    {step === 1 && <section className="wizard-step"><div className="wizard-heading"><span><UserRound /></span><div><strong>Cliente da ordem</strong><p>Troque o cliente ou edite o cadastro dele sem sair daqui.</p></div></div><div className="client-picker"><div>{localClients.map((client) => <button type="button" key={client.id} onClick={() => { setClientId(client.id); setEditingClient(false); }} className={clientId === client.id ? "selected" : ""}><span>{client.name.slice(0, 1).toUpperCase()}</span><div><strong>{client.name}</strong><small>{client.whatsapp} · {client.neighborhood || "Sem endereço"}</small></div>{clientId === client.id && <Check />}</button>)}</div></div>{selectedClient && !editingClient && <button type="button" className="inline-mode-switch" onClick={() => setEditingClient(true)}><Pencil /> Editar dados do cliente</button>}{selectedClient && editingClient && <InlineClientEditor client={selectedClient} onCancel={() => setEditingClient(false)} onSaved={(updated) => { setLocalClients((current) => current.map((entry) => entry.id === updated.id ? updated : entry)); setEditingClient(false); }} />}</section>}
    {step === 2 && <section className="wizard-step"><div className="wizard-heading"><span><Sparkles /></span><div><strong>Serviços e preços</strong><p>Adicione, remova, crie serviço/modelo e coloque o preço que quiser nesta ordem.</p></div></div><ItemsEditor items={items.length ? items : [newItem()]} setItems={setItems} services={localServices} setServices={setLocalServices} presets={presets} returnPresetId={returnPresetId} setReturnPresetId={setReturnPresetId} /><div className="live-total"><span><small>Novo total</small><strong>{money(totals.total)}</strong></span><span><Clock3 />{Math.floor(totals.duration / 60)}h{String(totals.duration % 60).padStart(2, "0")}</span></div></section>}
    {step === 3 && <section className="wizard-step"><div className="wizard-heading"><span><MapPin /></span><div><strong>Endereço, agenda e observações</strong><p>Todos estes dados pertencem à ordem e podem ser alterados.</p></div></div><div className="visual-choice-grid two-options"><button type="button" className={wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(true)}><span><House /></span><strong>Usar endereço</strong><small>Editar abaixo</small></button><button type="button" className={!wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(false)}><span><X /></span><strong>Sem endereço</strong><small>Remover da OS</small></button></div>{wantsAddress && <div className="wizard-reveal address-reveal"><AddressFields value={address} onChange={setAddress} /></div>}<div className="form-grid two"><label>Data<input type="date" required value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /></label><label>Hora<input type="time" required value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} /></label></div><div className="return-section"><div><strong>Prazo de retorno</strong></div><div className="return-chip-grid">{presets.filter((preset) => preset.active).map((preset) => <button type="button" key={preset.id} className={returnPresetId === preset.id ? "selected" : ""} onClick={() => setReturnPresetId(preset.id)}><Check />{preset.label}</button>)}</div></div><div className="form-grid two"><label>Desconto geral<div className="compound-input"><select value={discountType} onChange={(event) => setDiscountType(event.target.value as "fixed" | "percent")}><option value="fixed">R$</option><option value="percent">%</option></select><input type="number" min="0" step="0.01" value={discountValue || ""} onChange={(event) => setDiscountValue(Number(event.target.value))} placeholder="Sem desconto" /></div></label><label>Observações<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div></section>}
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}<div className="modal-actions wizard-actions"><button type="button" className="button-secondary" onClick={() => step === 1 ? discardAndClose() : setStep((current) => Math.max(1, current - 1))}>{step === 1 ? "Cancelar" : <><ArrowLeft /> Voltar</>}</button>{step < 3 ? <button type="button" className="button-admin-primary" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setError(""); setStep((current) => Math.min(3, current + 1)); }}>Continuar <ArrowRight /></button> : <button type="submit" className="button-admin-primary" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Salvando..." : "Salvar todas as alterações"}</button>}</div>
  </form></Modal>{conflictCount > 0 && <ScheduleConflictDialog count={conflictCount} onChange={() => { setConflictCount(0); setStep(3); }} onContinue={() => { setConflictCount(0); bypassConflict.current = true; window.setTimeout(() => formRef.current?.requestSubmit(), 0); }} />}</>;
}

import { readFileSync, writeFileSync } from "node:fs";

function patchOrderEditor() {
  const path = "app/app/order-editor.tsx";
  let source = readFileSync(path, "utf8");

  const serviceButton = '<button type="button" className="text-action" onClick={() => setQuick({ itemKey: item.key, kind: "service", name: "", price: "", mode: "fixed", duration: 60 })}><Plus /> Serviço não cadastrado? Criar agora</button>';
  const modelButton = '{item.serviceId && <button type="button" className="text-action" onClick={() => setQuick({ itemKey: `${item.key}::${item.serviceId}`, kind: "option", name: "", price: item.unitPrice, mode: "fixed", duration: item.duration })}><Plus /> Criar modelo deste serviço</button>}';
  const quickMarker = '\n      {quick && (quick.itemKey === item.key || quick.itemKey.startsWith(`${item.key}::`)) && <QuickCatalogEditor';

  if (!source.includes('className="catalog-quick-actions"')) {
    if (!source.includes(serviceButton) || !source.includes(modelButton) || !source.includes(quickMarker)) {
      throw new Error("Não encontrei o bloco esperado de criação rápida na OS.");
    }

    source = source.replace(serviceButton, "").replace(modelButton, "");
    const actions = `
      <div className="catalog-quick-actions" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
        <button type="button" className="button-secondary" style={{ minHeight: 46, color: "#0759b7", background: "#eaf5ff", borderColor: "#83bff0", fontWeight: 900 }} onClick={() => setQuick({ itemKey: item.key, kind: "service", name: "", price: "", mode: "fixed", duration: 60 })}><Plus /> + Novo serviço</button>
        <button type="button" className="button-secondary" disabled={!item.serviceId} style={{ minHeight: 46, color: "#0759b7", background: "#eaf5ff", borderColor: "#83bff0", fontWeight: 900, opacity: item.serviceId ? 1 : .55 }} onClick={() => item.serviceId && setQuick({ itemKey: \`\${item.key}::\${item.serviceId}\`, kind: "option", name: "", price: item.unitPrice, mode: "fixed", duration: item.duration })}><Plus /> {item.serviceId ? "+ Novo modelo / categoria" : "Escolha o serviço primeiro"}</button>
      </div>`;
    source = source.replace(quickMarker, `${actions}${quickMarker}`);
  }

  if (!source.includes('value="__new_service__"')) {
    const oldServiceSelect = '<select value={item.serviceId} onChange={(event) => chooseService(item.key, event.target.value)}><option value="">Selecione</option>';
    const newServiceSelect = '<select value={item.serviceId} onChange={(event) => { const value = event.target.value; if (value === "__new_service__") { setQuick({ itemKey: item.key, kind: "service", name: "", price: "", mode: "fixed", duration: 60 }); return; } chooseService(item.key, value); }}><option value="">Selecione</option><option value="__new_service__">＋ Cadastrar novo serviço</option>';
    if (!source.includes(oldServiceSelect)) throw new Error("Não encontrei o select de serviço da OS.");
    source = source.replace(oldServiceSelect, newServiceSelect);
  }

  if (!source.includes('value="__new_option__"')) {
    const oldOptionSelect = '<select value={item.optionId} onChange={(event) => chooseOption(item.key, event.target.value)}><option value="">Sem modelo</option>';
    const newOptionSelect = '<select value={item.optionId} onChange={(event) => { const value = event.target.value; if (value === "__new_option__") { if (item.serviceId) setQuick({ itemKey: `${item.key}::${item.serviceId}`, kind: "option", name: "", price: item.unitPrice, mode: "fixed", duration: item.duration }); return; } chooseOption(item.key, value); }}><option value="">Sem modelo</option>{item.serviceId && <option value="__new_option__">＋ Cadastrar novo modelo / categoria</option>}' ;
    if (!source.includes(oldOptionSelect)) throw new Error("Não encontrei o select de modelo da OS.");
    source = source.replace(oldOptionSelect, newOptionSelect);
  }

  if (!source.includes('value="__new_service__"') || !source.includes('value="__new_option__"') || !source.includes('className="catalog-quick-actions"')) {
    throw new Error("A criação rápida de serviço/modelo não foi aplicada corretamente.");
  }

  writeFileSync(path, source);
}

function patchClientEditor() {
  const path = "app/app/dialogs.tsx";
  let source = readFileSync(path, "utf8");
  if (source.includes("Editar cliente e endereço")) return;

  const start = source.indexOf("export function EditClientDialog");
  const end = source.indexOf("\ntype ItemDraft =", start);
  if (start < 0 || end < 0) throw new Error("Não encontrei o editor de cliente.");

  const replacement = `export function EditClientDialog({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void | Promise<void> }) {
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
    if (duplicate) return setError(\`Este WhatsApp já pertence a \${duplicate.name}.\`);
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

  return <Modal title={\`Editar \${client.name}\`} subtitle="Editar cliente e endereço" onClose={onClose} panelClassName="modal-client"><form className="modal-form client-wizard" onSubmit={submit} onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <section className="wizard-step"><div className="wizard-heading"><span><Pencil /></span><div><strong>Dados do cliente</strong><p>Nome, WhatsApp e endereço ficam na mesma tela. Nada fecha até você salvar ou cancelar.</p></div></div>
      <label className="visual-field"><span>Nome <b className="required-mark">obrigatório</b></span><div className="visual-input"><UserRound /><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></div></label>
      <WhatsappField value={whatsapp} onChange={setWhatsapp} onDuplicate={setDuplicate} excludeClientId={client.id} />
      <div className="wizard-heading"><span><MapPin /></span><div><strong>Endereço</strong><p>Edite qualquer campo abaixo ou remova o endereço do cadastro.</p></div></div>
      <div className="visual-choice-grid two-options"><button type="button" className={wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(true)}><span><House /></span><strong>Usar endereço</strong><small>Editar os dados abaixo</small></button><button type="button" className={!wantsAddress ? "selected" : ""} onClick={() => setWantsAddress(false)}><span><X /></span><strong>Sem endereço</strong><small>Remover do cadastro</small></button></div>
      {wantsAddress && <div className="wizard-reveal address-reveal"><AddressFields value={address} onChange={setAddress} /></div>}
    </section>
    {error && <div className="form-alert error"><AlertTriangle />{error}</div>}
    <div className="modal-actions wizard-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button-admin-primary" disabled={busy || Boolean(duplicate)}>{busy ? <Loader2 className="spin" /> : <Save />}{busy ? "Salvando..." : "Salvar cliente e endereço"}</button></div>
  </form></Modal>;
}`;

  source = source.slice(0, start) + replacement + source.slice(end);
  if (!source.includes("Editar cliente e endereço") || !source.includes("Salvar cliente e endereço")) throw new Error("A correção do editor de cliente não foi aplicada.");
  writeFileSync(path, source);
}

function patchCancellationVerification() {
  const path = "app/app/management.tsx";
  let source = readFileSync(path, "utf8");
  if (source.includes("Cancelamento não foi confirmado pelo banco")) return;

  const oldBlock = '    const { error } = await supabase.rpc("yan_cancel_order", { p_order_id: order.id, p_reason: reason });\n    if (error) notify(error.message); else { notify(received > 0 ? "Ordem cancelada e valor estornado automaticamente." : "Ordem cancelada e retirada dos totais."); await onRefresh(); }';
  const newBlock = '    const { error } = await supabase.rpc("yan_cancel_order", { p_order_id: order.id, p_reason: reason });\n    if (error) { notify(error.message); return; }\n    const { data: confirmed, error: verifyError } = await supabase.from("yan_orders").select("status").eq("id", order.id).single();\n    if (verifyError || confirmed?.status !== "cancelled") { notify("Cancelamento não foi confirmado pelo banco. Atualize a tela e tente novamente."); return; }\n    notify(received > 0 ? "Ordem cancelada e valor estornado automaticamente." : "Ordem cancelada e retirada dos totais.");\n    await onRefresh();';

  if (!source.includes(oldBlock)) throw new Error("Não encontrei o bloco esperado de cancelamento.");
  source = source.replace(oldBlock, newBlock);
  writeFileSync(path, source);
}

patchOrderEditor();
patchClientEditor();
patchCancellationVerification();
console.log("Correções de OS e edição de cliente aplicadas antes do build.");

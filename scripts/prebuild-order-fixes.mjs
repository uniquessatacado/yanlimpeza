import { readFileSync, writeFileSync } from "node:fs";

function patchOrderEditor() {
  const path = "app/app/order-editor.tsx";
  let source = readFileSync(path, "utf8");

  if (!source.includes('className="catalog-quick-actions"')) {
    const serviceButton = '<button type="button" className="text-action" onClick={() => setQuick({ itemKey: item.key, kind: "service", name: "", price: "", mode: "fixed", duration: 60 })}><Plus /> Serviço não cadastrado? Criar agora</button>';
    const modelButton = '{item.serviceId && <button type="button" className="text-action" onClick={() => setQuick({ itemKey: `${item.key}::${item.serviceId}`, kind: "option", name: "", price: item.unitPrice, mode: "fixed", duration: item.duration })}><Plus /> Criar modelo deste serviço</button>}';
    const quickMarker = '\n      {quick && (quick.itemKey === item.key || quick.itemKey.startsWith(`${item.key}::`)) && <QuickCatalogEditor';

    if (!source.includes(serviceButton) || !source.includes(modelButton) || !source.includes(quickMarker)) {
      throw new Error("Não encontrei o bloco esperado de criação rápida na OS.");
    }

    source = source.replace(serviceButton, "").replace(modelButton, "");

    const actions = `
      <div className="catalog-quick-actions" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
        <button type="button" className="button-secondary" style={{ minHeight: 44, color: "#0a6cc7", background: "#eef7ff", borderColor: "#b9d9f5" }} onClick={() => setQuick({ itemKey: item.key, kind: "service", name: "", price: "", mode: "fixed", duration: 60 })}><Plus /> Criar serviço novo</button>
        <button type="button" className="button-secondary" disabled={!item.serviceId} style={{ minHeight: 44, color: "#0a6cc7", background: "#eef7ff", borderColor: "#b9d9f5", opacity: item.serviceId ? 1 : .55 }} onClick={() => item.serviceId && setQuick({ itemKey: \`\${item.key}::\${item.serviceId}\`, kind: "option", name: "", price: item.unitPrice, mode: "fixed", duration: item.duration })}><Plus /> {item.serviceId ? "Criar modelo deste serviço" : "Escolha um serviço para criar modelo"}</button>
      </div>`;

    source = source.replace(quickMarker, `${actions}${quickMarker}`);
    writeFileSync(path, source);
  }
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
patchCancellationVerification();
console.log("Correções de OS aplicadas antes do build.");

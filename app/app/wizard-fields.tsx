"use client";

import { AlertCircle, Camera, Check, Loader2, MapPin, MessageCircle, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { digits } from "../lib/format";
import { findClientByWhatsapp, lookupCep, type AddressDraft, type CepStatus } from "../lib/workflow";

export function WizardProgress({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className={`wizard-progress steps-${labels.length}`} aria-label={`Etapa ${step} de ${labels.length}`}>
      {labels.map((label, index) => {
        const number = index + 1;
        return (
          <div key={label} className={step === number ? "active" : step > number ? "complete" : ""}>
            <span>{step > number ? <Check /> : number}</span>
            <strong>{label}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function WhatsappField({
  value,
  onChange,
  onDuplicate,
  excludeClientId,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onDuplicate?: (duplicate: { id: string; name: string; whatsapp: string } | null) => void;
  excludeClientId?: string;
  autoFocus?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; whatsapp: string } | null>(null);
  const phone = digits(value);

  useEffect(() => {
    if (phone.length < 10 || phone.length > 15) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setChecking(true);
      try {
        const found = await findClientByWhatsapp(phone, excludeClientId);
        if (!cancelled) {
          setDuplicate(found);
          onDuplicate?.(found);
        }
      } catch {
        if (!cancelled) {
          setDuplicate(null);
          onDuplicate?.(null);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 320);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [excludeClientId, phone, onDuplicate]);

  return (
    <label className="visual-field">
      <span>WhatsApp com DDD <b className="required-mark">obrigatório</b></span>
      <div className={duplicate ? "visual-input duplicate" : "visual-input"}>
        <MessageCircle />
        <input
          autoFocus={autoFocus}
          required
          inputMode="tel"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (digits(next).length < 10 || digits(next).length > 15) {
              setDuplicate(null);
              onDuplicate?.(null);
            }
            onChange(next);
          }}
          placeholder="(11) 99999-9999"
          autoComplete="tel"
        />
        {checking && <Loader2 className="spin input-status-icon" />}
        {!checking && phone.length >= 10 && !duplicate && <Check className="input-status-icon success" />}
      </div>
      {duplicate ? (
        <small className="duplicate-warning"><AlertCircle /> Este WhatsApp já pertence a <strong>{duplicate.name}</strong>.</small>
      ) : (
        <small>O sistema avisa aqui mesmo se o número já estiver cadastrado.</small>
      )}
    </label>
  );
}

export function AddressFields({ value, onChange }: { value: AddressDraft; onChange: (value: AddressDraft) => void }) {
  const [status, setStatus] = useState<CepStatus>("idle");
  const [message, setMessage] = useState("");

  const update = (key: keyof AddressDraft, nextValue: string) => onChange({ ...value, [key]: nextValue });

  async function searchCep() {
    setStatus("loading");
    setMessage("");
    try {
      const result = await lookupCep(value.zipcode);
      onChange({ ...value, ...result });
      setStatus("found");
      setMessage("Endereço encontrado. Complete o número e o complemento.");
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : "Não foi possível consultar o CEP.";
      setStatus(text.includes("não encontrado") ? "not-found" : "error");
      setMessage(text);
    }
  }

  return (
    <div className="address-fields">
      <label className="span-3 cep-first">
        CEP <span>opcional</span>
        <div className="cep-input-row">
          <div className="visual-input compact"><MapPin /><input inputMode="numeric" value={value.zipcode} onChange={(event) => { update("zipcode", event.target.value); setStatus("idle"); setMessage(""); }} placeholder="00000-000" /></div>
          <button type="button" onClick={() => void searchCep()} disabled={status === "loading" || digits(value.zipcode).length !== 8}>{status === "loading" ? <Loader2 className="spin" /> : <Search />} Buscar</button>
        </div>
        {message && <small className={`cep-message ${status}`}>{status === "found" ? <Check /> : <AlertCircle />}{message}</small>}
        {!message && <small>Se não souber o CEP, continue e preencha o endereço manualmente.</small>}
      </label>
      <div className="form-grid address">
        <label className="span-2">Rua ou avenida<input value={value.street} onChange={(event) => update("street", event.target.value)} placeholder="Nome da rua" /></label>
        <label>Número<input value={value.street_number} onChange={(event) => update("street_number", event.target.value)} placeholder="Nº" /></label>
        <label className="span-2">Bairro<input value={value.neighborhood} onChange={(event) => update("neighborhood", event.target.value)} placeholder="Bairro" /></label>
        <label>Complemento <span>opcional</span><input value={value.complement} onChange={(event) => update("complement", event.target.value)} placeholder="Apto, bloco..." /></label>
        <label className="span-2">Cidade<input value={value.city} onChange={(event) => update("city", event.target.value)} placeholder="Cidade" /></label>
        <label>Estado<input maxLength={2} value={value.state} onChange={(event) => update("state", event.target.value.toUpperCase())} placeholder="SP" /></label>
      </div>
    </div>
  );
}

export function PhotoPicker({ files, onChange, title, text }: { files: File[]; onChange: (files: File[]) => void; title: string; text: string }) {
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  function append(selected: FileList | null) {
    if (!selected) return;
    onChange([...files, ...Array.from(selected)].slice(0, 8));
  }

  return (
    <div className="photo-picker">
      <div className="photo-picker-copy"><span><Camera /></span><div><strong>{title}</strong><p>{text}</p></div></div>
      <label className="photo-add"><Camera /><span>{files.length ? "Adicionar mais fotos" : "Escolher ou tirar fotos"}</span><input type="file" accept="image/*" multiple onChange={(event) => append(event.target.files)} /></label>
      {previews.length > 0 && <div className="photo-preview-grid">{previews.map((preview, index) => <div key={`${preview.file.name}-${preview.file.lastModified}-${index}`}><img src={preview.url} alt={`Foto ${index + 1}`} /><button type="button" onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Remover foto ${index + 1}`}><Trash2 /></button><span>{index + 1}</span></div>)}</div>}
      <small>Opcional · até 8 fotos. O sistema otimiza as imagens antes de salvar.</small>
    </div>
  );
}

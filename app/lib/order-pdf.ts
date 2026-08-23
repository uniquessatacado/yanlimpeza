import { jsPDF } from "jspdf";
import { money } from "./format";
import type { Order, YanSettings } from "./types";
import { signedPhotoUrls } from "./workflow";

function humanDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function warrantyLabel(settings: YanSettings | null) {
  const value = settings?.warranty_value ?? 6;
  const unit = settings?.warranty_unit ?? "months";
  return `${value} ${unit === "days" ? (value === 1 ? "dia" : "dias") : (value === 1 ? "mês" : "meses")}`;
}

const paymentMethods: Record<string, string> = { pix: "Pix", cash: "Dinheiro", card: "Cartão", transfer: "Transferência", other: "Outro" };

async function urlToDataUrl(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function buildOrderPdf(order: Order, settings: YanSettings | null) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 16;
  let y = 0;

  const addHeader = () => {
    doc.setFillColor(6, 29, 57);
    doc.rect(0, 0, pageWidth, 39, "F");
    doc.setFillColor(15, 126, 225);
    doc.rect(0, 39, pageWidth, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("YAN LIMPEZA", margin, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(settings?.pdf_title || "Comprovante de serviço e garantia", margin, 27);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`ORDEM #${order.order_number}`, pageWidth - margin, 18, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Concluída em ${humanDate(order.completed_at)}`, pageWidth - margin, 27, { align: "right" });
    y = 51;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - 17) return;
    doc.addPage();
    addHeader();
  };

  const sectionTitle = (title: string) => {
    ensureSpace(12);
    doc.setTextColor(11, 85, 151);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title.toUpperCase(), margin, y);
    y += 5;
    doc.setDrawColor(211, 225, 238);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
  };

  const infoRow = (label: string, value: string, x: number, width: number) => {
    doc.setTextColor(108, 125, 143);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(label.toUpperCase(), x, y);
    doc.setTextColor(25, 52, 78);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(value || "Não informado", width);
    doc.text(lines, x, y + 5);
  };

  const paragraph = (text: string, tone: [number, number, number] = [67, 86, 104]) => {
    if (!text.trim()) return;
    const lines = doc.splitTextToSize(text.trim(), pageWidth - margin * 2);
    ensureSpace(lines.length * 4 + 8);
    doc.setTextColor(...tone); doc.setFont("helvetica", "normal"); doc.setFontSize(8.8); doc.text(lines, margin, y); y += lines.length * 4 + 8;
  };

  addHeader();
  paragraph(settings?.pdf_intro || "Obrigado por confiar na Yan Limpeza. Este documento registra o atendimento realizado.", [45, 67, 88]);
  sectionTitle("Cliente e atendimento");
  infoRow("Cliente", order.client?.name ?? "Cliente", margin, 75);
  infoRow("WhatsApp", order.client?.whatsapp ?? "—", 98, 45);
  infoRow("Data do serviço", humanDate(order.scheduled_start), 149, 44);
  y += 16;
  const address = [order.street, order.street_number, order.complement, order.neighborhood, order.city, order.state, order.zipcode].filter(Boolean).join(", ");
  infoRow("Endereço", address || "Não informado", margin, pageWidth - margin * 2);
  y += 16;

  sectionTitle("Serviços realizados");
  paragraph(settings?.pdf_service_notes || "Os serviços abaixo foram executados conforme a avaliação e o combinado com o cliente.");
  (order.items ?? []).forEach((item, index) => {
    ensureSpace(18);
    doc.setFillColor(index % 2 === 0 ? 245 : 250, index % 2 === 0 ? 249 : 252, 253);
    doc.roundedRect(margin, y - 3, pageWidth - margin * 2, 14, 2, 2, "F");
    doc.setTextColor(24, 50, 75);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(item.description, margin + 4, y + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const measurement = item.width_m && item.length_m ? ` · ${item.width_m} m × ${item.length_m} m = ${item.quantity} m²` : ` · Quantidade: ${item.quantity}`;
    doc.text(settings?.pdf_show_prices === false ? measurement : `${measurement} · ${money(item.line_total)}`, margin + 4, y + 7);
    y += 17;
  });

  if (settings?.pdf_show_prices !== false) {
    ensureSpace(25);
    doc.setFillColor(7, 116, 215); doc.roundedRect(pageWidth - margin - 70, y, 70, 19, 3, 3, "F");
    doc.setTextColor(220, 239, 255); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.text("VALOR TOTAL", pageWidth - margin - 65, y + 6);
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(money(order.total), pageWidth - margin - 5, y + 14, { align: "right" }); y += 27;
  }

  if (settings?.pdf_show_payment !== false) {
    sectionTitle("Pagamento");
    const payments = order.payments ?? []; const receivables = order.receivables ?? [];
    const paid = payments.reduce((sum, entry) => sum + (entry.kind === "payment" ? Number(entry.amount) : -Number(entry.amount)), 0);
    const open = receivables.filter((entry) => ["pending", "partial"].includes(entry.status)).reduce((sum, entry) => sum + Number(entry.balance), 0);
    const methods = [...new Set(payments.filter((entry) => entry.kind === "payment").map((entry) => paymentMethods[entry.method] ?? entry.method))].join(", ");
    ensureSpace(28); const paymentWidth = (pageWidth - margin * 2 - 8) / 3;
    [["SITUAÇÃO", open > 0 ? "A receber" : paid > 0 ? "Pago" : "Não informado"], ["VALOR PAGO", money(paid)], ["FORMA", methods || (open > 0 ? "Pagamento futuro" : "Não informada")]].forEach(([label, value], index) => {
      const x = margin + index * (paymentWidth + 4); doc.setFillColor(242, 247, 251); doc.roundedRect(x, y - 2, paymentWidth, 21, 3, 3, "F"); doc.setTextColor(99, 116, 132); doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.text(label, x + 4, y + 4); doc.setTextColor(22, 57, 86); doc.setFontSize(10); doc.text(String(value), x + 4, y + 12);
    }); y += 27;
    if (open > 0) paragraph(`Saldo em aberto: ${money(open)}. ${receivables.filter((entry) => ["pending", "partial"].includes(entry.status)).map((entry) => `Parcela ${entry.installment_number}: ${money(entry.balance)}, vence em ${new Intl.DateTimeFormat("pt-BR").format(new Date(`${entry.due_date}T12:00:00`))}`).join("; ")}.`);
    paragraph(settings?.pdf_payment_notes || "Guarde este comprovante para consultar pagamentos, garantia e recomendações.");
  }

  if (settings?.pdf_show_warranty !== false) {
  sectionTitle("Retorno e garantia");
  ensureSpace(33);
  const boxWidth = (pageWidth - margin * 2 - 6) / 2;
  doc.setFillColor(234, 246, 255);
  doc.roundedRect(margin, y - 2, boxWidth, 27, 3, 3, "F");
  doc.setTextColor(12, 98, 172);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("PRÓXIMO RETORNO", margin + 5, y + 5);
  doc.setTextColor(20, 55, 85);
  doc.setFontSize(12);
  doc.text(order.return_label ?? "Conforme combinado", margin + 5, y + 14);
  doc.setFillColor(235, 249, 242);
  doc.roundedRect(margin + boxWidth + 6, y - 2, boxWidth, 27, 3, 3, "F");
  doc.setTextColor(18, 125, 79);
  doc.setFontSize(8);
  doc.text("PRAZO DE GARANTIA", margin + boxWidth + 11, y + 5);
  doc.setTextColor(20, 55, 85);
  doc.setFontSize(12);
  doc.text(warrantyLabel(settings), margin + boxWidth + 11, y + 14);
  y += 33;

  const guarantee = settings?.warranty_notes || "Garantia referente ao serviço executado, conforme as condições informadas pela Yan Limpeza.";
  doc.setTextColor(81, 99, 117);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const guaranteeLines = doc.splitTextToSize(guarantee, pageWidth - margin * 2);
  doc.text(guaranteeLines, margin, y);
  y += guaranteeLines.length * 4 + 7;
  }

  if (settings?.pdf_aftercare?.trim()) { sectionTitle("Cuidados depois do serviço"); paragraph(settings.pdf_aftercare); }

  if (order.notes) {
    sectionTitle("Observações");
    doc.setTextColor(45, 65, 84);
    doc.setFontSize(9);
    const notes = doc.splitTextToSize(order.notes, pageWidth - margin * 2);
    doc.text(notes, margin, y);
    y += notes.length * 4 + 8;
  }

  const signed = settings?.pdf_show_photos === false ? [] : await signedPhotoUrls(order.photos ?? []);
  const groups = [
    { title: "Antes do serviço", photos: signed.filter((entry) => entry.photo.phase === "before") },
    { title: "Depois do serviço", photos: signed.filter((entry) => entry.photo.phase === "after") },
  ];
  for (const group of groups) {
    if (!group.photos.length) continue;
    sectionTitle(group.title);
    const thumbWidth = 55;
    const thumbHeight = 40;
    for (let index = 0; index < Math.min(group.photos.length, 6); index += 1) {
      if (index % 3 === 0) ensureSpace(thumbHeight + 8);
      const x = margin + (index % 3) * (thumbWidth + 6);
      try {
        const data = await urlToDataUrl(group.photos[index].url);
        doc.addImage(data, "JPEG", x, y, thumbWidth, thumbHeight, undefined, "FAST");
      } catch {
        doc.setFillColor(239, 243, 247);
        doc.roundedRect(x, y, thumbWidth, thumbHeight, 2, 2, "F");
        doc.setTextColor(117, 132, 146);
        doc.setFontSize(8);
        doc.text("Foto registrada", x + thumbWidth / 2, y + thumbHeight / 2, { align: "center" });
      }
      if (index % 3 === 2 || index === Math.min(group.photos.length, 6) - 1) y += thumbHeight + 7;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(222, 230, 237);
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
    doc.setTextColor(117, 130, 143);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(settings?.pdf_footer || `${settings?.business_name ?? "Yan Limpeza"} · ${settings?.whatsapp ?? "(11) 94024-5487"}`, margin, pageHeight - 8);
    doc.text(`Página ${page} de ${pages}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  const blob = doc.output("blob");
  return new File([blob], `Yan-Limpeza-Ordem-${order.order_number}.pdf`, { type: "application/pdf" });
}

export async function deliverOrderPdf(order: Order, settings: YanSettings | null, preferShare = false) {
  const file = await buildOrderPdf(order, settings);
  if (preferShare && navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: `Ordem #${order.order_number} · Yan Limpeza`, text: "Comprovante do serviço e garantia.", files: [file] });
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));

export const shortDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`))
    : "—";

export const dateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "Sem horário";

export const digits = (value: string) => value.replace(/\D/g, "");

export const whatsappLink = (phone: string, message?: string) =>
  `https://wa.me/${digits(phone)}${message ? `?text=${encodeURIComponent(message)}` : ""}`;

export const todayIso = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};


export type Profile = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "agent";
  active: boolean;
};

export type Service = {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  default_return_preset_id: string | null;
  options?: ServiceOption[];
};

export type ServiceOption = {
  id: string;
  service_id: string;
  name: string;
  pricing_mode: "fixed" | "per_m2" | "per_unit";
  sale_price: number | null;
  cost_price: number | null;
  duration_minutes: number;
  return_months: number;
  return_preset_id: string | null;
  active: boolean;
  sort_order: number;
};

export type ReturnPreset = {
  id: string;
  label: string;
  value: number;
  unit: "days" | "months";
  active: boolean;
  sort_order: number;
};

export type Client = {
  id: string;
  name: string;
  whatsapp: string;
  email: string | null;
  previous_customer: boolean;
  last_service_date: string | null;
  last_service_description: string | null;
  street: string | null;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  zipcode: string | null;
  latitude: number | null;
  longitude: number | null;
  decision_status: "pending" | "booked" | "not_now" | "lost";
  follow_up_at: string | null;
  notes: string | null;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  service_id: string;
  option_id: string | null;
  description: string;
  pricing_mode: "fixed" | "per_m2" | "per_unit";
  quantity: number;
  unit_price: number;
  unit_cost: number;
  discount_type: "fixed" | "percent";
  discount_value: number;
  discount_amount: number;
  line_total: number;
  duration_minutes: number;
  width_m: number | null;
  length_m: number | null;
  service?: Pick<Service, "id" | "name">;
  option?: Pick<ServiceOption, "id" | "name"> | null;
};

export type OrderPhoto = {
  id: string;
  order_id: string;
  phase: "before" | "after";
  storage_path: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
};

export type Order = {
  id: string;
  order_number: number;
  client_id: string;
  status: "draft" | "scheduled" | "in_progress" | "completed" | "cancelled" | "refunded";
  scheduled_start: string | null;
  scheduled_end: string | null;
  street: string | null;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  return_value: number | null;
  return_unit: "days" | "months" | null;
  return_label: string | null;
  subtotal: number;
  item_discount_total: number;
  discount_type: "fixed" | "percent";
  discount_value: number;
  discount_amount: number;
  total: number;
  cost_total: number;
  notes: string | null;
  cancellation_reason: string | null;
  completed_at: string | null;
  created_at: string;
  client?: Client;
  items?: OrderItem[];
  photos?: OrderPhoto[];
  receivables?: Receivable[];
  payments?: Payment[];
};

export type YanSettings = {
  id: string;
  business_name: string;
  whatsapp: string;
  city: string;
  state: string;
  default_return_months: number;
  default_payment_days: number;
  warranty_value: number;
  warranty_unit: "days" | "months";
  warranty_notes: string;
  workdays: number[];
  work_start: string;
  work_end: string;
  slot_interval_minutes: number;
  pdf_title: string;
  pdf_intro: string;
  pdf_service_notes: string;
  pdf_aftercare: string;
  pdf_payment_notes: string;
  pdf_footer: string;
  pdf_show_prices: boolean;
  pdf_show_payment: boolean;
  pdf_show_warranty: boolean;
  pdf_show_photos: boolean;
};

export type Receivable = {
  id: string;
  order_id: string;
  installment_number: number;
  amount: number;
  paid_amount: number;
  balance: number;
  due_date: string;
  status: "pending" | "partial" | "paid" | "cancelled";
  paid_at: string | null;
  notes: string | null;
  order?: Pick<Order, "order_number"> & { client?: Pick<Client, "name" | "whatsapp"> };
};

export type Payment = {
  id: string;
  order_id: string;
  receivable_id: string | null;
  kind: "payment" | "refund";
  amount: number;
  method: string;
  occurred_at: string;
};

export type FollowUp = {
  id: string;
  client_id: string;
  service_id: string | null;
  source_order_id: string | null;
  due_date: string;
  kind: "decision" | "recurrence" | "manual";
  status: "pending" | "contacted" | "booked" | "snoozed" | "dismissed";
  notes: string | null;
  client?: Client;
  service?: Pick<Service, "name"> | null;
};

import { supabase } from "./supabase";
import type { OrderPhoto } from "./types";
import { digits } from "./format";

export type AddressDraft = {
  zipcode: string;
  street: string;
  street_number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type CepStatus = "idle" | "loading" | "found" | "not-found" | "error";

export async function lookupCep(value: string): Promise<Partial<AddressDraft>> {
  const zipcode = digits(value);
  if (zipcode.length !== 8) throw new Error("Digite os 8 números do CEP.");
  const response = await fetch(`https://viacep.com.br/ws/${zipcode}/json/`);
  if (!response.ok) throw new Error("Não foi possível consultar o CEP agora.");
  const data = await response.json() as {
    erro?: boolean;
    logradouro?: string;
    bairro?: string;
    localidade?: string;
    uf?: string;
  };
  if (data.erro) throw new Error("CEP não encontrado. Você pode preencher o endereço manualmente.");
  return {
    zipcode,
    street: data.logradouro ?? "",
    neighborhood: data.bairro ?? "",
    city: data.localidade ?? "",
    state: data.uf ?? "",
  };
}

export async function findClientByWhatsapp(value: string, excludeId?: string) {
  const whatsapp = digits(value);
  if (whatsapp.length < 10 || whatsapp.length > 15) return null;
  let query = supabase.from("yan_clients").select("id,name,whatsapp").eq("whatsapp", whatsapp);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as { id: string; name: string; whatsapp: string } | null;
}

function imageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Imagem não suportada.")); };
    image.src = url;
  });
}

async function preparePhoto(file: File): Promise<{ blob: Blob; extension: string }> {
  try {
    const image = await imageFromFile(file);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = longest > 1800 ? 1800 / longest : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem.");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("Não foi possível comprimir a imagem.");
    return { blob, extension: "jpg" };
  } catch {
    if (file.size > 10 * 1024 * 1024) throw new Error(`A foto “${file.name}” é maior que 10 MB.`);
    const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    return { blob: file, extension };
  }
}

export async function uploadOrderPhotos(orderId: string, phase: "before" | "after", files: File[]) {
  if (!files.length) return [] as OrderPhoto[];
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Sua sessão expirou. Entre novamente para enviar fotos.");

  const uploaded: OrderPhoto[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const prepared = await preparePhoto(files[index]);
    const unique = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `${orderId}/${phase}/${unique}.${prepared.extension}`;
    const { error: uploadError } = await supabase.storage
      .from("yan-order-photos")
      .upload(path, prepared.blob, { contentType: prepared.blob.type || files[index].type || "image/jpeg", upsert: false });
    if (uploadError) throw new Error(`Não foi possível enviar a foto ${index + 1}: ${uploadError.message}`);

    const { data, error: metadataError } = await supabase
      .from("yan_order_photos")
      .insert({ order_id: orderId, phase, storage_path: path, sort_order: index, created_by: userData.user.id })
      .select("*")
      .single();
    if (metadataError) {
      await supabase.storage.from("yan-order-photos").remove([path]);
      throw new Error(`A foto foi enviada, mas não pôde ser ligada à ordem: ${metadataError.message}`);
    }
    uploaded.push(data as OrderPhoto);
  }
  return uploaded;
}

export async function signedPhotoUrls(photos: OrderPhoto[]) {
  if (!photos.length) return [] as { photo: OrderPhoto; url: string }[];
  const { data, error } = await supabase.storage
    .from("yan-order-photos")
    .createSignedUrls(photos.map((photo) => photo.storage_path), 60 * 30);
  if (error) throw error;
  return photos.map((photo, index) => ({ photo, url: data[index]?.signedUrl ?? "" })).filter((entry) => entry.url);
}

export function serviceAgeLabel(value: string | null) {
  if (!value) return "Ainda não fez serviço";
  const target = new Date(`${value.slice(0, 10)}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - target.getTime()) / 86_400_000));
  if (days === 0) return "Fez serviço hoje";
  if (days === 1) return "Fez serviço há 1 dia";
  return `Fez serviço há ${days} dias`;
}


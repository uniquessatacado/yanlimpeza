"use client";

import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, LogIn, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";
import { Management } from "./management";

export default function ManagementPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) return <FullLoader label="Preparando seu espaço de trabalho" />;
  if (!session) return <AuthScreen />;
  return <AccessGate session={session} />;
}

function AccessGate({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [error, setError] = useState("");

  const loadProfile = useCallback(async () => {
    setError("");
    const { data, error: profileError } = await supabase
      .from("yan_profiles")
      .select("user_id,email,full_name,role,active")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (profileError) setError(profileError.message);
    setProfile((data as Profile | null) ?? null);
  }, [session.user.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProfile(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfile]);

  if (profile === undefined) return <FullLoader label="Verificando seu acesso" />;
  if (error) return <AccessMessage title="Não foi possível verificar o acesso" text={error} action="Tentar novamente" onAction={() => void loadProfile()} />;
  if (!profile) return <BootstrapScreen onActivated={loadProfile} />;
  if (!profile.active) return <PendingScreen profile={profile} />;
  return <Management profile={profile} />;
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    if (mode === "register" && fullName.trim().length < 2) {
      setError("Informe seu nome completo."); setBusy(false); return;
    }
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName.trim() } } });
    if (result.error) {
      const translations: Record<string, string> = {
        "Invalid login credentials": "E-mail ou senha incorretos.",
        "User already registered": "Este e-mail já possui cadastro. Use a opção Entrar.",
        "Password should be at least 6 characters": "A senha precisa ter pelo menos 6 caracteres.",
      };
      setError(translations[result.error.message] ?? result.error.message);
    } else if (mode === "register" && !result.data.session) {
      setMessage("Cadastro criado. Confira seu e-mail para confirmar o acesso e depois volte para entrar.");
    }
    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <Link className="back-to-site" href="/"><ArrowLeft /> Voltar ao site</Link>
      <div className="auth-brand">
        <img src="/yan-logo.jpeg" alt="Yan Limpeza" />
        <div><strong>YAN</strong><span>Gestão inteligente</span></div>
      </div>
      <section className="auth-card">
        <div className="auth-icon"><ShieldCheck /></div>
        <span className="auth-kicker">Área da equipe</span>
        <h1>{mode === "login" ? "Bem-vindo de volta" : "Crie seu acesso"}</h1>
        <p>{mode === "login" ? "Entre para organizar clientes, agenda e financeiro." : "Novos membros aguardam a aprovação do administrador."}</p>
        <form onSubmit={submit} className="auth-form">
          {mode === "register" && <label>Nome completo<div className="input-with-icon"><UserRound /><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" autoComplete="name" /></div></label>}
          <label>E-mail<div className="input-with-icon"><Mail /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" required autoComplete="email" /></div></label>
          <label>Senha<div className="input-with-icon"><LockKeyhole /><input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="Mostrar senha">{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
          {error && <div className="form-alert error">{error}</div>}
          {message && <div className="form-alert success"><CheckCircle2 />{message}</div>}
          <button className="primary-submit" disabled={busy}>{busy ? <Loader2 className="spin" /> : mode === "login" ? <LogIn /> : <Sparkles />}{busy ? "Aguarde..." : mode === "login" ? "Entrar no sistema" : "Criar meu acesso"}</button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setMessage(""); }}>{mode === "login" ? "Primeiro acesso? Criar conta" : "Já possui acesso? Entrar"}</button>
      </section>
    </main>
  );
}

function BootstrapScreen({ onActivated }: { onActivated: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function activate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc("yan_claim_access", { p_bootstrap_token: token.trim() });
    if (rpcError) setError(rpcError.message);
    else await onActivated();
    setBusy(false);
  }

  return (
    <main className="auth-shell">
      <div className="auth-brand"><img src="/yan-logo.jpeg" alt="Yan Limpeza" /><div><strong>YAN</strong><span>Gestão inteligente</span></div></div>
      <section className="auth-card bootstrap-card">
        <div className="auth-icon"><LockKeyhole /></div><span className="auth-kicker">Configuração inicial</span>
        <h1>Ative o primeiro administrador</h1><p>Digite a chave inicial entregue com o sistema. Ela funciona uma única vez.</p>
        <form onSubmit={activate} className="auth-form"><label>Chave inicial<div className="input-with-icon"><LockKeyhole /><input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Cole a chave aqui" required /></div></label>
          {error && <div className="form-alert error">{error}</div>}
          <button className="primary-submit" disabled={busy || !token.trim()}>{busy ? <Loader2 className="spin" /> : <ShieldCheck />}{busy ? "Ativando..." : "Ativar administração"}</button>
        </form>
        <button className="auth-switch" onClick={() => void supabase.auth.signOut()}>Sair e usar outra conta</button>
      </section>
    </main>
  );
}

function PendingScreen({ profile }: { profile: Profile }) {
  return <main className="auth-shell"><div className="auth-brand"><img src="/yan-logo.jpeg" alt="Yan Limpeza" /><div><strong>YAN</strong><span>Gestão inteligente</span></div></div><section className="auth-card"><div className="auth-icon"><Clock3Icon /></div><span className="auth-kicker">Cadastro recebido</span><h1>Aguardando aprovação</h1><p>Olá, {profile.full_name ?? profile.email}. O administrador precisa liberar sua conta antes do primeiro acesso.</p><button className="primary-submit" onClick={() => void supabase.auth.signOut()}>Sair</button></section></main>;
}

function Clock3Icon() { return <CheckCircle2 />; }

function AccessMessage({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-icon"><ShieldCheck /></div><h1>{title}</h1><p>{text}</p><button className="primary-submit" onClick={onAction}>{action}</button></section></main>;
}

function FullLoader({ label }: { label: string }) {
  return <main className="auth-shell loading-shell"><div className="loader-mark"><img src="/yan-logo.jpeg" alt="" /><Loader2 className="spin" /></div><p>{label}</p></main>;
}

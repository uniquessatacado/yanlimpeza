"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Armchair,
  BedDouble,
  CalendarCheck,
  CarFront,
  Check,
  ChevronRight,
  Clock3,
  Droplets,
  MapPin,
  Menu,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { whatsappLink } from "./lib/format";

const whatsapp = "5511940245487";

const services = [
  { icon: Armchair, name: "Sofás", text: "Limpeza profunda de assentos, encostos e módulos para renovar conforto e aparência." },
  { icon: BedDouble, name: "Colchões", text: "Higienização cuidadosa da superfície onde você descansa todas as noites." },
  { icon: Armchair, name: "Cadeiras e poltronas", text: "Atendimento por peça para salas de jantar, escritórios e ambientes comerciais." },
  { icon: Droplets, name: "Tapetes", text: "Tratamento de acordo com a metragem e o tipo de pelo do seu tapete." },
  { icon: CarFront, name: "Bancos de carro", text: "Limpeza interna dos bancos para um carro mais agradável no dia a dia." },
  { icon: ShieldCheck, name: "Impermeabilização", text: "Proteção contra líquidos e derramamentos, preservando o toque do tecido." },
];

const pieces = [
  { id: "sofa", label: "Sofá", icon: Armchair },
  { id: "colchao", label: "Colchão", icon: BedDouble },
  { id: "tapete", label: "Tapete", icon: Droplets },
  { id: "carro", label: "Bancos do carro", icon: CarFront },
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [piece, setPiece] = useState("sofa");
  const [months, setMonths] = useState(6);
  const [pets, setPets] = useState(false);
  const [children, setChildren] = useState(false);
  const [stains, setStains] = useState(false);

  const care = useMemo(() => {
    let score = Math.min(58, months * 4);
    if (pets) score += 16;
    if (children) score += 10;
    if (stains) score += 20;
    score = Math.min(100, Math.max(12, score));
    const level = score >= 72 ? "Atenção alta" : score >= 45 ? "Hora de cuidar" : "Cuidado preventivo";
    const copy = score >= 72
      ? "Seu estofado reúne sinais que merecem uma avaliação profissional em breve."
      : score >= 45
        ? "Este é um bom momento para planejar a higienização e preservar o estofado."
        : "O cuidado preventivo ajuda a manter o tecido bonito e agradável por mais tempo.";
    return { score, level, copy };
  }, [children, months, pets, stains]);

  const selectedPiece = pieces.find((item) => item.id === piece)?.label ?? "estofado";
  const quoteMessage = `Olá, Yan! Fiz o diagnóstico de cuidado no site para ${selectedPiece.toLowerCase()} e gostaria de um orçamento. Resultado: ${care.level}.`;

  return (
    <main className="public-site">
      <header className="public-header">
        <a className="brand-lockup" href="#inicio" aria-label="Yan Limpeza — início">
          <img src="/yan-logo.jpeg" alt="Símbolo Yan Limpeza" />
          <span><strong>YAN</strong><small>Limpeza de estofados</small></span>
        </a>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">
          {menuOpen ? <X /> : <Menu />}
        </button>
        <nav className={menuOpen ? "public-nav open" : "public-nav"}>
          <a href="#servicos" onClick={() => setMenuOpen(false)}>Serviços</a>
          <a href="#diagnostico" onClick={() => setMenuOpen(false)}>Diagnóstico</a>
          <a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a>
          <a className="nav-quote" href={whatsappLink(whatsapp, "Olá, Yan! Gostaria de pedir um orçamento.")} target="_blank" rel="noreferrer"><MessageCircle size={18} /> Pedir orçamento</a>
        </nav>
      </header>

      <section className="hero" id="inicio">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={15} /> Seu estofado merece cuidado profissional</div>
          <h1>Conforto renovado.<br /><span>Limpeza que você percebe.</span></h1>
          <p>Higienização profissional de sofás, colchões, tapetes, poltronas, cadeiras e bancos de carro em Indaiatuba e região.</p>
          <div className="hero-actions">
            <a className="button button-primary" href={whatsappLink(whatsapp, "Olá, Yan! Quero solicitar um orçamento de higienização.")} target="_blank" rel="noreferrer"><MessageCircle /> Orçamento pelo WhatsApp <ArrowRight size={18} /></a>
            <a className="button button-ghost" href="#diagnostico">Avaliar meu estofado</a>
          </div>
          <div className="trust-row">
            <span><ShieldCheck /> Garantia de 6 meses*</span>
            <span><MapPin /> Indaiatuba · SP</span>
            <span><Star /> Desde 2021</span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-image-wrap"><img src="/yan-servicos.jpeg" alt="Serviços de limpeza e higienização profissional Yan" /></div>
          <div className="floating-proof proof-top"><span className="proof-icon"><Sparkles /></span><span><strong>Atendimento profissional</strong><small>Equipamentos e produtos premium</small></span></div>
          <div className="floating-proof proof-bottom"><span className="proof-icon"><Clock3 /></span><span><strong>Secagem eficiente</strong><small>Cuidado em cada etapa</small></span></div>
        </div>
      </section>

      <section className="public-stats" aria-label="Diferenciais">
        <div><strong>6 meses</strong><span>de garantia na aplicação*</span></div>
        <div><strong>+ saúde e conforto</strong><span>ambientes mais agradáveis</span></div>
        <div><strong>Produtos premium</strong><span>processo profissional</span></div>
        <div><strong>Atendimento rápido</strong><span>direto pelo WhatsApp</span></div>
      </section>

      <section className="public-section services-section" id="servicos">
        <div className="section-heading">
          <div><span className="section-kicker">Soluções para cada ambiente</span><h2>O cuidado certo para cada estofado</h2></div>
          <p>Avaliamos o tipo da peça e indicamos o processo adequado antes de começar.</p>
        </div>
        <div className="service-grid">
          {services.map(({ icon: Icon, name, text }, index) => (
            <article className="service-card" key={name}>
              <div className="service-number">0{index + 1}</div><div className="service-icon"><Icon /></div>
              <h3>{name}</h3><p>{text}</p>
              <a href={whatsappLink(whatsapp, `Olá, Yan! Gostaria de um orçamento para ${name.toLowerCase()}.`)} target="_blank" rel="noreferrer">Quero um orçamento <ChevronRight /></a>
            </article>
          ))}
        </div>
      </section>

      <section className="hygiene-section">
        <div className="hygiene-visual" aria-hidden="true">
          <div className="fabric-layer layer-one"><span>Poeira</span></div>
          <div className="fabric-layer layer-two"><span>Resíduos</span></div>
          <div className="fabric-layer layer-three"><span>Umidade</span></div>
          <div className="clean-core"><Sparkles /><strong>Cuidado<br />profundo</strong></div>
        </div>
        <div className="hygiene-copy">
          <span className="section-kicker">Além do que os olhos enxergam</span>
          <h2>O tecido também guarda a rotina da casa</h2>
          <p>Poeira, resíduos, pelos e umidade podem se acumular entre as fibras e favorecer a presença de ácaros, fungos e bactérias. A higienização profissional ajuda a remover sujidades e reduzir esse acúmulo.</p>
          <div className="hygiene-benefits">
            <span><ShieldCheck /><strong>Processo cuidadoso</strong><small>Avaliação do tecido antes da aplicação</small></span>
            <span><Droplets /><strong>Produtos adequados</strong><small>Tratamento pensado para cada peça</small></span>
            <span><Sparkles /><strong>Sensação renovada</strong><small>Ambiente mais limpo e agradável</small></span>
          </div>
        </div>
      </section>

      <section className="care-section" id="diagnostico">
        <div className="care-intro">
          <span className="section-kicker light">Diagnóstico interativo</span>
          <h2>Como está o seu estofado hoje?</h2>
          <p>Responda quatro pontos rápidos. Em menos de um minuto você recebe uma indicação personalizada para planejar o cuidado.</p>
          <div className="care-points"><span><Check /> Sem cadastro</span><span><Check /> Resultado imediato</span><span><Check /> Orçamento direto</span></div>
        </div>
        <div className="care-tool">
          <div className="care-fields">
            <label>1. O que você quer cuidar?</label>
            <div className="piece-picker">
              {pieces.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setPiece(id)} className={piece === id ? "selected" : ""}><Icon /><span>{label}</span></button>)}
            </div>
            <label htmlFor="months">2. Há quanto tempo foi a última limpeza?</label>
            <div className="range-head"><span>{months === 0 ? "Recentemente" : `${months} ${months === 1 ? "mês" : "meses"}`}</span><small>0 a 18+ meses</small></div>
            <input id="months" className="care-range" type="range" min="0" max="18" value={months} onChange={(event) => setMonths(Number(event.target.value))} />
            <label>3. O que faz parte da rotina?</label>
            <div className="toggle-grid">
              <button className={pets ? "active" : ""} onClick={() => setPets(!pets)}><span>{pets ? <Check /> : null}</span>Animais em casa</button>
              <button className={children ? "active" : ""} onClick={() => setChildren(!children)}><span>{children ? <Check /> : null}</span>Crianças pequenas</button>
              <button className={stains ? "active" : ""} onClick={() => setStains(!stains)}><span>{stains ? <Check /> : null}</span>Manchas ou odores</button>
            </div>
          </div>
          <div className="care-result">
            <div className="score-ring" style={{ "--score": `${care.score * 3.6}deg` } as React.CSSProperties}><div><strong>{care.score}</strong><small>de 100</small></div></div>
            <span className="result-label">{care.level}</span><h3>{selectedPiece}: cuidado sob medida</h3><p>{care.copy}</p>
            <a className="button button-primary full" href={whatsappLink(whatsapp, quoteMessage)} target="_blank" rel="noreferrer"><MessageCircle /> Enviar resultado ao Yan</a>
            <small className="result-note">Este resultado é orientativo. A recomendação final depende da avaliação do tecido e do estado da peça.</small>
          </div>
        </div>
      </section>

      <section className="public-section process-section" id="como-funciona">
        <div className="section-heading centered"><div><span className="section-kicker">Simples do começo ao fim</span><h2>Você chama. A Yan cuida.</h2></div></div>
        <div className="process-grid">
          <article><span>01</span><MessageCircle /><h3>Conte o que precisa</h3><p>Envie fotos e informações da peça pelo WhatsApp.</p></article>
          <article><span>02</span><CalendarCheck /><h3>Agende o melhor horário</h3><p>Combinamos a visita de acordo com a sua rotina.</p></article>
          <article><span>03</span><Sparkles /><h3>Acompanhe a transformação</h3><p>Executamos o processo com cuidado e orientação completa.</p></article>
        </div>
      </section>

      <section className="guarantee-section">
        <div className="guarantee-seal"><ShieldCheck /><strong>6</strong><span>meses<br />de garantia*</span></div>
        <div><span className="section-kicker light">Compromisso com o serviço</span><h2>Proteção, cuidado e transparência</h2><p>A garantia cobre manchas que possam surgir após o serviço, relacionadas à aplicação. Condições avaliadas conforme o material e o estado do estofado.</p></div>
        <a className="button button-light" href={whatsappLink(whatsapp, "Olá, Yan! Quero saber mais sobre o serviço e a garantia.")} target="_blank" rel="noreferrer">Conversar com o Yan <ArrowRight /></a>
      </section>

      <section className="final-cta">
        <img src="/yan-logo.jpeg" alt="Yan Limpeza" />
        <div><span className="section-kicker">Seu ambiente mais agradável começa aqui</span><h2>Vamos renovar seus estofados?</h2><p>Envie uma foto pelo WhatsApp e receba uma orientação para o seu caso.</p></div>
        <a className="button button-primary" href={whatsappLink(whatsapp, "Olá, Yan! Quero enviar fotos para pedir um orçamento.")} target="_blank" rel="noreferrer"><MessageCircle /> Chamar no WhatsApp</a>
      </section>

      <footer className="public-footer">
        <div className="brand-lockup footer-brand"><img src="/yan-logo.jpeg" alt="" /><span><strong>YAN</strong><small>Limpeza de estofados</small></span></div>
        <p>Higienização profissional em Indaiatuba e região · (11) 94024-5487</p><a href="/app">Área de gestão</a>
      </footer>
      <a className="floating-whatsapp" href={whatsappLink(whatsapp, "Olá, Yan! Vim pelo site e gostaria de um orçamento.")} target="_blank" rel="noreferrer" aria-label="Chamar no WhatsApp"><MessageCircle /><span>Pedir orçamento</span></a>
    </main>
  );
}

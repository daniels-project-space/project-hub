"use client";

import Link from "next/link";
import { ArrowUpRight, Check, ChevronLeft, Compass, MapPin, Play, Sparkles, X } from "lucide-react";
import { useState } from "react";

const rooms = [
  { label: "Arrival", detail: "A private, sea-facing approach with the entire home in view." },
  { label: "Living room", detail: "Floor-to-ceiling windows, warm stone, and an uninterrupted horizon." },
  { label: "Pool terrace", detail: "A sunset-ready pool deck measured directly from the tour." },
  { label: "Primary suite", detail: "Wake up to the water — complete with storage and ensuite details." },
];

const stays = [
  ["Aster House", "Milos, Greece", "€684 / night"],
  ["Lune Cabin", "Vesterålen, Norway", "€412 / night"],
  ["Casa Sol", "Puglia, Italy", "€531 / night"],
] as const;

export default function VeraStayPage() {
  const [tourOpen, setTourOpen] = useState(false);
  const [room, setRoom] = useState(0);
  const [requested, setRequested] = useState(false);

  return (
    <main className="min-h-dvh bg-[#151814] text-[#f3f1e9] selection:bg-[#dfe7bb] selection:text-[#151814]">
      <section className="relative min-h-[760px] overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[#30372e]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_22%_72%,rgba(205,213,159,0.28),transparent_30%),radial-gradient(ellipse_at_78%_22%,rgba(231,202,156,0.25),transparent_31%),linear-gradient(135deg,#1b211c_4%,#52614d_42%,#1d241f_100%)]" />
        <div className="absolute -right-[11%] bottom-[-16%] h-[77%] w-[62%] rounded-[44%_44%_0_0] border border-white/20 bg-[linear-gradient(160deg,rgba(255,255,255,0.35),rgba(255,255,255,0.04)_16%,rgba(0,0,0,0.12)_70%)] shadow-[-32px_12px_80px_rgba(0,0,0,0.25)]" />
        <div className="absolute bottom-0 right-[9%] h-[45%] w-[49%] rounded-t-[45%] bg-[linear-gradient(140deg,rgba(13,18,15,0.7),rgba(90,104,80,0.18))] blur-[1px]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,15,12,0.74)_0%,rgba(12,15,12,0.31)_48%,rgba(12,15,12,0.12)_100%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.15)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />

        <nav className="relative z-10 mx-auto flex max-w-[1440px] items-center justify-between px-6 py-7 sm:px-10 lg:px-14">
          <Link href="/" className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/65 transition hover:text-white">
            <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
            Project Hub
          </Link>
          <div className="absolute left-1/2 -translate-x-1/2 font-sans text-sm font-semibold tracking-[0.26em] sm:text-base">VERA</div>
          <button onClick={() => setRequested(true)} className="hidden border border-white/35 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white transition hover:bg-white hover:text-[#1b211c] sm:inline-flex">
            List a home <ArrowUpRight className="ml-2 h-3 w-3" />
          </button>
        </nav>

        <div className="relative z-10 mx-auto flex min-h-[670px] max-w-[1440px] flex-col justify-center px-6 pb-24 pt-12 sm:px-10 lg:px-14">
          <div className="max-w-3xl">
            <p className="mb-6 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#e5edc1]">
              <span className="h-2 w-2 rounded-full bg-[#dce8a5] shadow-[0_0_14px_#dce8a5]" /> Verified spaces. Better stays.
            </p>
            <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-[clamp(3.9rem,9vw,8.7rem)] leading-[0.83] tracking-[-0.07em] text-[#f5f3ec]">
              Book the home<br />you can actually <em className="font-normal text-[#e5edc1]">explore.</em>
            </h1>
            <p className="mt-8 max-w-md text-base leading-7 text-white/76">Vera is a visual-first collection of remarkable homes. Walk every room, know the details, and book with confidence.</p>
            <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
              <button onClick={() => setTourOpen(true)} className="group inline-flex items-center gap-3 bg-[#f5f3ec] px-5 py-4 text-sm font-semibold text-[#1b211c] transition hover:bg-[#dfe7bb]">
                <Play className="h-3.5 w-3.5 fill-current" /> Walk this home <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
              <a href="#stays" className="inline-flex items-center gap-2 text-sm font-medium text-white/90 transition hover:text-[#e5edc1]">Explore the collection <ArrowUpRight className="h-4 w-4" /></a>
            </div>
          </div>
          <div className="absolute bottom-7 left-6 flex items-end gap-4 sm:left-10 lg:left-14">
            <span className="font-mono text-[10px] text-white/50">01 / 12</span>
            <div><p className="font-mono text-[8px] uppercase tracking-[0.18em] text-white/45">Featured stay</p><p className="mt-1 text-sm text-white">Aster House, Milos</p></div>
          </div>
          <button onClick={() => setTourOpen(true)} className="absolute bottom-7 right-6 hidden items-center gap-3 bg-[#161917]/90 px-4 py-3 text-left shadow-2xl backdrop-blur sm:flex lg:right-14">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#dfe7bb] text-[#1b211c]"><Compass className="h-4 w-4" /></span>
            <span><b className="block text-xs">Open verified tour</b><small className="mt-0.5 block font-mono text-[8px] uppercase tracking-[0.1em] text-white/50">4 rooms, 2,400 sq ft</small></span>
          </button>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1440px] gap-px border-x border-white/10 bg-white/10 sm:grid-cols-3">
        {[
          ["01", "Tour first", "Walk the property before you request a stay. Every listing starts with a verified visual walkthrough."],
          ["02", "Details, not guesswork", "Room dimensions, light, outdoor space and essential amenities — presented where they matter."],
          ["03", "A considered collection", "A smaller standard of homes, thoughtfully presented for guests who care where they stay."],
        ].map(([number, title, description]) => <article key={number} className="bg-[#151814] p-7 sm:p-9"><span className="font-mono text-[10px] text-[#dce8a5]">{number}</span><h2 className="mt-14 font-[family-name:var(--font-display)] text-4xl tracking-[-0.04em]">{title}</h2><p className="mt-4 max-w-xs leading-7 text-white/60">{description}</p></article>)}
      </section>

      <section id="stays" className="mx-auto max-w-[1440px] px-6 py-24 sm:px-10 lg:px-14">
        <div className="flex flex-wrap items-end justify-between gap-6"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#dce8a5]">Current collection</p><h2 className="mt-3 font-[family-name:var(--font-display)] text-5xl tracking-[-0.05em] sm:text-6xl">Stay somewhere <em className="text-[#cfd9a2]">worth arriving.</em></h2></div><button onClick={() => setRequested(true)} className="inline-flex items-center gap-2 border-b border-[#dce8a5] pb-1 text-sm text-[#e5edc1]">Request early access <ArrowUpRight className="h-4 w-4" /></button></div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">{stays.map(([name, place, price], index) => <button key={name} onClick={() => { setRoom(index % rooms.length); setTourOpen(true); }} className="group text-left"><div className={`relative aspect-[4/5] overflow-hidden ${index === 0 ? "bg-[radial-gradient(circle_at_20%_25%,#e9d0a4,transparent_15%),linear-gradient(145deg,#596650,#162119_74%)]" : index === 1 ? "bg-[radial-gradient(circle_at_78%_18%,#dbe8ff,transparent_15%),linear-gradient(145deg,#4b6e83,#0f1920_70%)]" : "bg-[radial-gradient(circle_at_40%_30%,#f2c891,transparent_18%),linear-gradient(145deg,#9b6443,#251d16_72%)]"}`}><div className="absolute inset-x-[12%] bottom-0 h-[58%] rounded-t-[35%] border border-white/15 bg-black/15 transition duration-500 group-hover:scale-105" /><span className="absolute left-4 top-4 rounded-full border border-white/25 bg-black/20 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.16em] text-white/80">Verified tour</span><span className="absolute right-4 top-4 font-mono text-[10px] text-white/50">0{index + 1}</span></div><div className="mt-4 flex items-start justify-between gap-3"><div><h3 className="text-lg">{name}</h3><p className="mt-1 flex items-center gap-1 text-sm text-white/50"><MapPin className="h-3 w-3" />{place}</p></div><b className="whitespace-nowrap text-sm font-medium text-[#e5edc1]">{price}</b></div></button>)}</div>
      </section>

      <section className="border-y border-white/10 bg-[#20251e]"><div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-6 py-16 sm:px-10 md:flex-row md:items-center md:justify-between lg:px-14"><div><p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#dce8a5]"><Sparkles className="h-3.5 w-3.5" /> For considered hosts</p><h2 className="mt-3 max-w-2xl font-[family-name:var(--font-display)] text-4xl tracking-[-0.045em] sm:text-5xl">Your home deserves more than a thumbnail.</h2></div><button onClick={() => setRequested(true)} className="inline-flex w-fit items-center gap-2 bg-[#dfe7bb] px-5 py-4 text-sm font-semibold text-[#1b211c] transition hover:bg-[#f5f3ec]">Start a conversation <ArrowUpRight className="h-4 w-4" /></button></div></section>

      <footer className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-7 text-xs text-white/45 sm:px-10 lg:px-14"><Link href="/" className="font-semibold tracking-[0.2em] text-white">VERA</Link><span>Interactive concept MVP within Project Hub</span></footer>

      {tourOpen && <div className="fixed inset-0 z-50 grid place-items-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="tour-title"><button className="absolute inset-0 bg-black/75 backdrop-blur-sm" aria-label="Close verified tour" onClick={() => setTourOpen(false)} /><section className="relative w-full max-w-5xl overflow-hidden border border-white/15 bg-[#191d18] shadow-2xl"><header className="flex items-start justify-between border-b border-white/10 p-5 sm:p-7"><div><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#dce8a5]">Verified virtual walkthrough</p><h2 id="tour-title" className="mt-2 font-[family-name:var(--font-display)] text-4xl tracking-[-0.05em]">Aster House</h2></div><button onClick={() => setTourOpen(false)} className="grid h-9 w-9 place-items-center border border-white/15 text-white/70 transition hover:bg-white hover:text-[#151814]" aria-label="Close"><X className="h-4 w-4" /></button></header><div className="relative aspect-[16/8] overflow-hidden bg-[radial-gradient(ellipse_at_34%_76%,rgba(214,230,184,.52),transparent_26%),radial-gradient(circle_at_74%_22%,rgba(241,207,154,.45),transparent_20%),linear-gradient(135deg,#384837,#829073_50%,#1b2920)]"><div className="absolute bottom-0 right-[9%] h-[63%] w-[58%] rounded-t-[42%] border border-white/25 bg-black/15" /><div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,.44),transparent_65%)]" /><span className="absolute bottom-5 left-5 font-mono text-[9px] uppercase tracking-[.18em] text-white/70">360° visual prototype</span><span className="absolute right-[22%] top-[39%] flex items-center gap-2 rounded-full border border-white/25 bg-black/35 px-3 py-2 text-xs backdrop-blur"><i className="h-2 w-2 rounded-full bg-[#dce8a5]" />Living room</span></div><div className="grid border-t border-white/10 sm:grid-cols-[1.2fr_1fr]"><div className="flex overflow-x-auto border-b border-white/10 sm:border-b-0 sm:border-r">{rooms.map((item, index) => <button key={item.label} onClick={() => setRoom(index)} className={`min-w-[116px] border-r border-white/10 px-4 py-5 text-left font-mono text-[9px] uppercase tracking-[.12em] transition ${room === index ? "bg-[#dfe7bb] text-[#151814]" : "text-white/50 hover:bg-white/5 hover:text-white"}`}><b className="mr-2 opacity-60">0{index + 1}</b>{item.label}</button>)}</div><p className="p-5 text-sm leading-6 text-white/65">{rooms[room].detail}</p></div></section></div>}
      {requested && <div className="fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 border border-[#dce8a5]/30 bg-[#242b20] p-4 shadow-2xl"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dfe7bb] text-[#182015]"><Check className="h-4 w-4" /></span><p className="text-sm leading-5 text-white/80">Concept request saved. Live host onboarding will be connected when the marketplace backend is ready.</p><button className="text-white/55 hover:text-white" onClick={() => setRequested(false)} aria-label="Dismiss"><X className="h-4 w-4" /></button></div>}
    </main>
  );
}

import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Heart } from 'lucide-react';

type PublicFundraiser = { slug: string; title: string; summary: string; goalAmount: number; confirmedAmount: number; imageUrl?: string };

export default function FundraiserBanner({ onOpen }: { onOpen: (slug: string) => void }) {
  const [fund, setFund] = useState<PublicFundraiser | null>(null);
  useEffect(() => {
    fetch('/api/fundraisers').then((r) => r.ok ? r.json() : null).then((j) => setFund(j?.fundraiser || null)).catch(() => {});
  }, []);
  if (!fund) return null;
  const progress = Math.min(100, (fund.confirmedAmount / Math.max(fund.goalAmount, 1)) * 100);
  return <section className="overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/15 via-white/[.04] to-white/[.02]" aria-label="Командный сбор">
    <div className="grid md:grid-cols-[220px_1fr]">
      {fund.imageUrl && <img src={fund.imageUrl} alt="Обложка командного сбора" className="h-full min-h-40 w-full object-cover" />}
      <div className="space-y-3 p-5 md:p-6">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[.18em] text-brand"><Heart className="h-3.5 w-3.5" /> Сейчас собираем командой</div>
        <h2 className="font-display text-xl font-black uppercase md:text-2xl">{fund.title}</h2>
        <p className="max-w-2xl text-sm leading-5 text-white/65">{fund.summary}</p>
        <div><div className="mb-1 flex justify-between text-xs"><b>{Math.round(fund.confirmedAmount)} BYN</b><span className="text-white/45">из {Math.round(fund.goalAmount)} BYN</span></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} /></div></div>
        <button type="button" onClick={() => onOpen(fund.slug)} className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-xs font-black uppercase tracking-wide text-black transition hover:brightness-110">Посмотреть сбор <ArrowUpRight className="h-4 w-4" /></button>
      </div>
    </div>
  </section>;
}
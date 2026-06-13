// Honest placeholder for portal sections whose own implementation plan hasn't
// landed yet. NOT a stub that fakes data — it states plainly what's coming.
export default function IntelComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="p-6">
      <div className="max-w-md border border-[#3a3a3a] border-l-[3px] border-l-[#d4a017] bg-[#070707] rounded-[2px] p-4">
        <div className="font-mono text-[9px] tracking-widest text-[#d4a017] uppercase">{phase}</div>
        <div className="text-[15px] text-white mt-1">{title}</div>
        <p className="text-[11px] text-[#888] mt-2 leading-relaxed">
          This section is part of the Intel Portal program and ships in its own plan. The portal shell, navigation,
          and right-hand context panel are live now; this surface activates when its build lands.
        </p>
      </div>
    </div>
  );
}

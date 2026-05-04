import React from 'react';
import {
  Trophy,
  Cpu,
  FileText,
  Map as MapIcon,
  Lock,
  Radio,
  Smartphone,
  Sparkles,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

// AdminCompetitiveTab — competitive comparison vs OpenISES (Tickets CAD).
// Static, read-only reference for sales / onboarding / internal alignment.
// Reachable at /admin?tab=competitive.

type Verdict = 'flex' | 'openises' | 'tie';

interface Row {
  dimension: string;
  openises: string;
  flex: string;
  verdict: Verdict;
}

const stackRows: Row[] = [
  { dimension: 'Frontend', openises: 'Server-rendered PHP + jQuery-era widgets', flex: 'React 18 + TypeScript + Vite 6 SPA', verdict: 'flex' },
  { dimension: 'Backend', openises: 'PHP 7.4+ on Apache', flex: 'Express 5 + TypeScript (tsx)', verdict: 'flex' },
  { dimension: 'Database', openises: 'MySQL / MariaDB', flex: 'SQLite (better-sqlite3, single-file, atomic backups)', verdict: 'flex' },
  { dimension: 'Real-time', openises: 'Server-Sent Events (one-way)', flex: 'Bidirectional WebSocket (broadcastDispatchUpdate, broadcastUnitUpdate)', verdict: 'flex' },
  { dimension: 'Deploy', openises: 'Docker / $5 VPS / Raspberry Pi', flex: 'systemd unit, blue-green-friendly rsync, auto-deploy webhook on git push origin main', verdict: 'flex' },
  { dimension: 'Versioning', openises: 'v3.44.1 stable, v4.0 in dev', flex: 'v5.8.0 with structured pino logging + request-IDs', verdict: 'flex' },
];

const mapRows: Row[] = [
  { dimension: 'Tile source', openises: 'Leaflet + OpenStreetMap', flex: 'Google Maps JS API + offline CartoDB dark_matter fallback', verdict: 'flex' },
  { dimension: 'Offline tiles', openises: 'None', flex: 'Service-worker pre-cached tiles for Utah Z7–15', verdict: 'flex' },
  { dimension: 'Geo hierarchy', openises: 'Flat locations', flex: '4-tier Miller drilldown: Areas → Sectors → Zones → Beats (6/29/288/719)', verdict: 'flex' },
  { dimension: 'Polygon overlays', openises: 'Custom markups', flex: 'beat.geojson (719 features), county / municipality / highway GeoJSON', verdict: 'flex' },
  { dimension: 'Point lookup', openises: 'None', flex: '/identify?lat&lng → returns full geographic stack', verdict: 'flex' },
  { dimension: 'GPS providers', openises: 'APRS, Meshtastic, OwnTracks, OpenGTS, DMR, browser', flex: 'Traccar dual-plane (live operational + historical archive with raw_json preservation)', verdict: 'tie' },
];

const rmsBullets = [
  'Incident RMS — UCR/NIBRS offenses, statute linkage, multi-officer roles, suspect/victim mapping (incident_offenses, incident_officers, incident_links)',
  'Master Name Index dossier endpoint (/api/records/persons/:id/dossier)',
  'Citations with multi-violation auto-summing, 39 extended fields, batch void/status',
  'Cases — 8 junction tables linking persons / vehicles / evidence / citations / warrants / properties',
  'Field Interviews with auto-numbered FI cards, GPS, person/vehicle linkage',
  'Warrants, Arrest records, Jail roster scraper with cross-links',
  'Court tracker, Forensic lab, Trespass orders, Use-of-force, Process service',
];

const securityBullets = [
  'JWT (access + refresh) + WebAuthn / FIDO2 / YubiKey + TOTP 2FA',
  'TOTP secrets AES-256-GCM encrypted with key derived from JWT_SECRET',
  'Role-based middleware (8 roles), audit log on every mutation',
  'Structured pino logging with per-request IDs (X-Request-Id header)',
  'Log-injection-safe logSafe() wrapper for tainted strings',
  'Evidence chain: Ed25519-signed evidence_hashes rows with publishable public keys for prosecutor exports — court chain-of-custody bar',
];

const consoleBullets = [
  'F-key hotkeys: F2 = New, F3 = Dispatch, F5 = Enroute, F6 = OnScene, F7 = Clear, F8 = CMD, F12 = NCIC',
  'CAD command line with 20+ commands, 10-code lookup, premise alerts',
  '70+ call-type protocols with auto-priority, backup rules, mandatory flags',
  'Spillman Flex / Motorola Solutions theme — pure black #0a0a0a, gold #d4a017, 2px corners, LED indicators with glow',
  'Edge TTS neural voice (en-US-JennyNeural) with radio squelch beeps, bandpass EQ, pink noise — actual radio audio processing',
];

const nativeBullets = [
  'Electron desktop (macOS DMG + Windows EXE) with offline sync, auto-update, IPC bridge',
  'Capacitor Android APK',
  'iOS PWA',
  'Edge Python runner for in-vehicle Jetson Orin Nano dashcam AI with HMAC-authenticated ingest',
];

const specialtyBullets = [
  'Skip Tracer V2 — 22 data sources (FBI Wanted, OFAC, NSOPW, Utah Courts, SLC Assessor) with rate limiting, caching, encrypted config',
  'Process Server / Civil Serve — 30+ column queue, GPS-tracked attempts, OCR fallback (ocrmypdf + Tesseract on serve packets)',
  'HR module — leave, discipline, performance reviews, overtime, full payroll pipeline',
  'Fleet management — vehicles, maintenance, fuel, inspections, damage reports',
  'Proprietary RMPG PDF Engine v1.0 — native parser/renderer/writer + pdf-lib fallback, qpdf-backed AES encryption, 80+ shipped editor features',
  'NCIC-style compound search + universal search across 9 record types',
];

const borrowItems: { title: string; body: string }[] = [
  {
    title: 'Draggable widget dashboard',
    body: 'Flex panels are mostly fixed layouts. Letting dispatchers rearrange the dispatch screen (calls / units / map / aggregates) would be a real UX win.',
  },
  {
    title: 'NIMS ICS forms (213, 214, 309) + Winlink XML export',
    body: 'Flex has no incident-command-system formal forms and zero radio-based fallback when internet drops. ICS-213 General Message and ICS-214 Activity Log are genuinely useful.',
  },
  {
    title: 'Granular permission matrix (65+ slots)',
    body: 'Flex has 8 role buckets. A permission matrix would let "client_viewer" be tunable per-feature instead of hard-coded.',
  },
  {
    title: 'Light theme variant',
    body: 'Flex is intentionally pure-black, but daylight outdoor use (officers reading tablets in sun) is a legitimate use case. Add a high-contrast light variant without abandoning the Spillman aesthetic for indoor consoles.',
  },
  {
    title: 'Multi-provider SMS + Zello PTT',
    body: 'Flex doesn’t currently have outbound SMS for dispatcher-to-civilian or dispatch-to-officer-phone messaging — Zello PTT integration would be lighter-weight than full radio.',
  },
];

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === 'flex') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase text-[#d4a017]">
        <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Flex
      </span>
    );
  }
  if (verdict === 'openises') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase text-[#888888]">
        <XCircle className="w-3 h-3" aria-hidden="true" /> OpenISES
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase text-[#888888]">
      Tie
    </span>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2 pb-1 border-b border-[#222222]">
      <Icon className="w-4 h-4 text-[#d4a017]" aria-hidden="true" />
      <h3 className="text-xs font-bold tracking-wider uppercase text-[#d0d0d0]">{title}</h3>
      {subtitle ? <span className="text-[10px] text-[#666] ml-auto">{subtitle}</span> : null}
    </div>
  );
}

function ComparisonTable({ rows }: { rows: Row[] }) {
  return (
    <div className="border border-[#222222] bg-[#0a0a0a]">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-[#141414] text-[9px] font-semibold uppercase tracking-wider text-[#888]">
            <th className="text-left px-2 py-[3px] border-b border-[#222]">Dimension</th>
            <th className="text-left px-2 py-[3px] border-b border-[#222]">OpenISES</th>
            <th className="text-left px-2 py-[3px] border-b border-[#222]">RMPG Flex</th>
            <th className="text-left px-2 py-[3px] border-b border-[#222] w-[70px]">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.dimension} className={idx % 2 === 0 ? 'bg-[#0a0a0a]' : 'bg-[#0d0d0d]'}>
              <td className="px-2 py-[3px] font-semibold text-[#d0d0d0]">{r.dimension}</td>
              <td className="px-2 py-[3px] text-[#888]">{r.openises}</td>
              <td className="px-2 py-[3px] text-[#d0d0d0]">{r.flex}</td>
              <td className="px-2 py-[3px]"><VerdictBadge verdict={r.verdict} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1 text-[11px] text-[#c8c8c8]">
      {items.map((b, i) => (
        <li key={i} className="flex gap-2">
          <CheckCircle2 className="w-3 h-3 mt-[3px] shrink-0 text-[#d4a017]" aria-hidden="true" />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AdminCompetitiveTab() {
  return (
    <div className="p-4 space-y-5">
      {/* Header card */}
      <div className="border border-[#222222] bg-gradient-to-r from-[#141414] to-[#0a0a0a] p-4">
        <div className="flex items-center gap-3 mb-2">
          <Trophy className="w-5 h-5 text-[#d4a017]" aria-hidden="true" />
          <h2 className="text-sm font-bold tracking-wider uppercase text-[#d0d0d0]">RMPG Flex vs OpenISES (Tickets CAD)</h2>
        </div>
        <p className="text-[11px] text-[#888] leading-relaxed">
          OpenISES is a competent <strong className="text-[#c8c8c8]">volunteer-event coordination CAD</strong> running on a Pi for $5/mo. RMPG Flex is a
          {' '}<strong className="text-[#d4a017]">sworn law-enforcement CAD/RMS</strong> with regulatory chain-of-custody, NIBRS reporting, modern SPA UX, true real-time, native cross-platform clients,
          and proprietary subsystems (PDF engine, dashcam edge AI, evidence signing) OpenISES doesn&rsquo;t attempt. The two aren&rsquo;t in the same market &mdash; but architecturally Flex is leagues ahead, and feature-wise Flex covers ~10&times; the surface area.
        </p>
      </div>

      {/* 1. Tech stack */}
      <section>
        <SectionHeader icon={Cpu} title="1. Tech stack &amp; architecture" subtitle="Flex wins on every axis" />
        <ComparisonTable rows={stackRows} />
        <p className="mt-2 text-[11px] text-[#888] leading-relaxed">
          <strong className="text-[#c8c8c8]">Why it matters:</strong> SSE means every status change reaches dispatchers via long-poll; Flex&rsquo;s WebSocket lets dispatch console state stay live for officer GPS, call updates, presence, and BOLO broadcasts simultaneously, with no fan-in latency.
        </p>
      </section>

      {/* 2. RMS */}
      <section>
        <SectionHeader icon={FileText} title="2. Records Management" subtitle="Entire category OpenISES doesn't have" />
        <p className="text-[11px] text-[#888] mb-2">OpenISES is dispatch-only. Flex is dispatch <strong className="text-[#c8c8c8]">+ RMS</strong>:</p>
        <BulletList items={rmsBullets} />
        <p className="mt-2 text-[10px] text-[#666] italic">
          OpenISES has none of this &mdash; its &ldquo;Personnel Roster&rdquo; is volunteer profiles with FCC callsigns, not a sworn-officer / suspect / victim master index.
        </p>
      </section>

      {/* 3. Maps */}
      <section>
        <SectionHeader icon={MapIcon} title="3. Maps &amp; geography" subtitle="Flex significantly more capable" />
        <ComparisonTable rows={mapRows} />
        <p className="mt-2 text-[10px] text-[#666] italic">
          OpenISES has more amateur-radio GPS providers (APRS, DMR-GPS, Meshtastic). Flex is purpose-built for fleet GPS via Traccar.
        </p>
      </section>

      {/* 4. Auth */}
      <section>
        <SectionHeader icon={Lock} title="4. Authentication &amp; security" subtitle="Flex is enterprise-grade" />
        <BulletList items={securityBullets} />
      </section>

      {/* 5. Console */}
      <section>
        <SectionHeader icon={Radio} title="5. Dispatch console UX" subtitle="Flex is professional CAD-grade" />
        <BulletList items={consoleBullets} />
      </section>

      {/* 6. Native */}
      <section>
        <SectionHeader icon={Smartphone} title="6. Native clients &amp; offline" subtitle="Flex has the full multi-platform story" />
        <BulletList items={nativeBullets} />
        <p className="mt-2 text-[10px] text-[#666] italic">OpenISES = browser only.</p>
      </section>

      {/* 7. Specialty */}
      <section>
        <SectionHeader icon={Sparkles} title="7. Specialty subsystems" subtitle="Flex has, OpenISES does not" />
        <BulletList items={specialtyBullets} />
      </section>

      {/* 8. Borrow list */}
      <section>
        <SectionHeader icon={Sparkles} title="8. Worth borrowing from OpenISES" subtitle="Roadmap candidates" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {borrowItems.map((b, i) => (
            <div key={i} className="border border-[#222] bg-[#0d0d0d] p-2.5">
              <div className="text-[11px] font-semibold text-[#d4a017] mb-1">{b.title}</div>
              <div className="text-[11px] text-[#a8a8a8] leading-snug">{b.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <div className="border-t border-[#222222] pt-3 text-[10px] text-[#555]">
        Source: <code className="text-[#888]">openises.sourceforge.net</code> &middot; Reviewed 2026-05-04 &middot; Internal reference, not customer-facing.
      </div>
    </div>
  );
}

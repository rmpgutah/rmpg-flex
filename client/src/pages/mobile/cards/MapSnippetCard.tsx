import { Link } from 'react-router';

export default function MapSnippetCard() {
  return (
    <section className="bg-surface-base border border-border-default p-3">
      <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest mb-2">MAP</h2>
      <Link to="/map" className="block">
        <div className="w-full h-[240px] bg-surface-overlay border border-border-default relative overflow-hidden">
          <img
            src="/maps/utah-slc-z11.png"
            alt="Salt Lake Valley"
            className="absolute inset-0 w-full h-full object-cover opacity-90"
            loading="lazy"
          />
        </div>
      </Link>
      <div className="mt-2 text-right text-[10px] text-[color:var(--field-label-color)] uppercase tracking-widest">
        <Link to="/map">Open full map →</Link>
      </div>
    </section>
  );
}

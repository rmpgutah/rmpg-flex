import { Link } from 'react-router-dom';

export default function MapSnippetCard() {
  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">MAP</h2>
      <Link to="/map" className="block">
        <div className="w-full h-[240px] bg-[#050505] border border-[#1a1a1a] relative overflow-hidden">
          <img
            src="/maps/utah-slc-z11.png"
            alt="Salt Lake Valley"
            className="absolute inset-0 w-full h-full object-cover opacity-90"
            loading="lazy"
          />
        </div>
      </Link>
      <div className="mt-2 text-right text-[10px] text-[#d4a017] uppercase tracking-widest">
        <Link to="/map">Open full map →</Link>
      </div>
    </section>
  );
}

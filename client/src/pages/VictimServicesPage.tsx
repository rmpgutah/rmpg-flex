import React from 'react';
import PanelTitleBar from '../components/PanelTitleBar';
import { Heart, Shield, Phone, FileText } from 'lucide-react';

export default function VictimServicesPage() {
  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="VICTIM SERVICES" icon={Heart} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel-beveled p-4">
          <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-3">Services Available</h3>
          <div className="space-y-2 text-[11px] text-rmpg-300">
            <div className="flex items-center gap-2"><Shield size={14} className="text-brand-gold" /><span>Crisis intervention & safety planning</span></div>
            <div className="flex items-center gap-2"><Phone size={14} className="text-brand-gold" /><span>24/7 victim hotline: (801) 555-0199</span></div>
            <div className="flex items-center gap-2"><FileText size={14} className="text-brand-gold" /><span>Restitution assistance & victim compensation</span></div>
            <div className="flex items-center gap-2"><Heart size={14} className="text-brand-gold" /><span>Counseling referrals & support groups</span></div>
          </div>
        </div>
        <div className="panel-beveled p-4">
          <h3 className="text-label font-bold uppercase tracking-wider text-brand-gold mb-3">Marsy's Law Rights</h3>
          <div className="text-[10px] text-rmpg-400 space-y-1">
            <p>• Right to be treated with fairness and respect</p>
            <p>• Right to be free from intimidation and harassment</p>
            <p>• Right to be reasonably protected from the accused</p>
            <p>• Right to reasonable notice of all public proceedings</p>
            <p>• Right to be heard at any proceeding involving release, plea, or sentencing</p>
            <p>• Right to confer with the prosecuting attorney</p>
            <p>• Right to restitution</p>
            <p>• Right to proceedings free from unreasonable delay</p>
          </div>
        </div>
      </div>
    </div>
  );
}

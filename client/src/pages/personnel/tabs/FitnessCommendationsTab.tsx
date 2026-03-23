import React, { useState, useEffect } from 'react';
import { Activity, Award, Plus, TrendingUp, Star } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';

interface FitnessScore {
  date: string;
  score: number;
  run_time: string;
  pushups: number;
  situps: number;
  notes: string;
}

interface Commendation {
  id: number;
  date: string;
  type: string;
  description: string;
  awarded_by_name: string;
  created_at: string;
}

export default function FitnessCommendationsTab({ officerId }: { officerId: string | number }) {
  const { addToast } = useToast();
  const [fitness, setFitness] = useState<FitnessScore[]>([]);
  const [commendations, setCommendations] = useState<Commendation[]>([]);
  const [showFitnessForm, setShowFitnessForm] = useState(false);
  const [showCommForm, setShowCommForm] = useState(false);
  const [fitnessForm, setFitnessForm] = useState({ date: new Date().toISOString().slice(0, 10), score: '', run_time: '', pushups: '', situps: '', notes: '' });
  const [commForm, setCommForm] = useState({ date: new Date().toISOString().slice(0, 10), type: 'commendation', description: '' });

  const loadFitness = async () => {
    try { const data = await apiFetch<any[]>(`/personnel/fitness/${officerId}`); setFitness(data); } catch { /* handled */ }
  };

  const loadCommendations = async () => {
    try { const data = await apiFetch<any[]>(`/personnel/commendations/${officerId}`); setCommendations(data); } catch { /* handled */ }
  };

  useEffect(() => { loadFitness(); loadCommendations(); }, [officerId]);

  const submitFitness = async () => {
    try { await apiFetch<any[]>(`/personnel/fitness/${officerId}`, {
      method: 'POST', body: JSON.stringify({
        ...fitnessForm,
        score: fitnessForm.score ? Number(fitnessForm.score) : null,
        pushups: fitnessForm.pushups ? Number(fitnessForm.pushups) : null,
        situps: fitnessForm.situps ? Number(fitnessForm.situps) : null,
      }),
    }); addToast('Fitness score recorded', 'success'); setShowFitnessForm(false); loadFitness(); } catch { /* handled */ }
  };

  const submitComm = async () => {
    if (!commForm.description) { addToast('Description required', 'error'); return; }
    try { await apiFetch<any[]>(`/personnel/commendations/${officerId}`, { method: 'POST', body: JSON.stringify(commForm) }); addToast('Commendation added', 'success'); setShowCommForm(false); setCommForm({ date: new Date().toISOString().slice(0, 10), type: 'commendation', description: '' }); loadCommendations(); } catch { /* handled */ }
  };

  return (
    <div className="space-y-4">
      {/* Fitness Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-white flex items-center gap-1"><Activity className="w-3.5 h-3.5 text-green-400" /> Physical Fitness Tracking</h3>
          <button type="button" onClick={() => setShowFitnessForm(!showFitnessForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Record Score</button>
        </div>

        {showFitnessForm && (
          <div className="panel-inset p-3 space-y-2 mb-2">
            <div className="grid grid-cols-3 gap-2">
              <input type="date" value={fitnessForm.date} onChange={e => setFitnessForm(f => ({ ...f, date: e.target.value }))} className="input-field text-xs" />
              <input type="number" value={fitnessForm.score} onChange={e => setFitnessForm(f => ({ ...f, score: e.target.value }))} className="input-field text-xs" placeholder="Overall Score" />
              <input value={fitnessForm.run_time} onChange={e => setFitnessForm(f => ({ ...f, run_time: e.target.value }))} className="input-field text-xs" placeholder="Run Time (e.g. 12:30)" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={fitnessForm.pushups} onChange={e => setFitnessForm(f => ({ ...f, pushups: e.target.value }))} className="input-field text-xs" placeholder="Pushups" />
              <input type="number" value={fitnessForm.situps} onChange={e => setFitnessForm(f => ({ ...f, situps: e.target.value }))} className="input-field text-xs" placeholder="Situps" />
              <input value={fitnessForm.notes} onChange={e => setFitnessForm(f => ({ ...f, notes: e.target.value }))} className="input-field text-xs" placeholder="Notes" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={submitFitness} className="toolbar-btn toolbar-btn-success text-[9px]">Save</button>
              <button type="button" onClick={() => setShowFitnessForm(false)} className="toolbar-btn text-[9px]">Cancel</button>
            </div>
          </div>
        )}

        {fitness.length > 0 ? (
          <div className="space-y-1">
            {fitness.slice(0, 10).map((f, i) => (
              <div key={i} className="panel-inset p-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-rmpg-400">{f.date}</span>
                  {f.score && <span className="text-xs font-bold text-white">Score: {f.score}</span>}
                  {f.run_time && <span className="text-[10px] text-rmpg-300">Run: {f.run_time}</span>}
                  {f.pushups && <span className="text-[10px] text-rmpg-300">PU: {f.pushups}</span>}
                  {f.situps && <span className="text-[10px] text-rmpg-300">SU: {f.situps}</span>}
                </div>
                {f.notes && <span className="text-[10px] text-rmpg-400 italic">{f.notes}</span>}
              </div>
            ))}
            {fitness.length > 1 && (
              <div className="panel-inset p-2 text-center">
                <TrendingUp className={`w-4 h-4 inline mr-1 ${
                  (fitness[0]?.score || 0) >= (fitness[1]?.score || 0) ? 'text-green-400' : 'text-red-400'
                }`} />
                <span className="text-[10px] text-rmpg-300">
                  Trend: {(fitness[0]?.score || 0) >= (fitness[1]?.score || 0) ? 'Improving' : 'Declining'}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-rmpg-500 text-center py-2">No fitness scores recorded</p>
        )}
      </div>

      {/* Commendations Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-white flex items-center gap-1"><Award className="w-3.5 h-3.5 text-amber-400" /> Commendations & Awards</h3>
          <button type="button" onClick={() => setShowCommForm(!showCommForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Add</button>
        </div>

        {showCommForm && (
          <div className="panel-inset p-3 space-y-2 mb-2">
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={commForm.date} onChange={e => setCommForm(f => ({ ...f, date: e.target.value }))} className="input-field text-xs" />
              <select value={commForm.type} onChange={e => setCommForm(f => ({ ...f, type: e.target.value }))} className="input-field text-xs">
                <option value="commendation">Commendation</option>
                <option value="award">Award</option>
                <option value="medal">Medal</option>
                <option value="citation">Citation</option>
                <option value="letter_of_recognition">Letter of Recognition</option>
              </select>
            </div>
            <textarea value={commForm.description} onChange={e => setCommForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={2} placeholder="Description..." />
            <div className="flex gap-2">
              <button type="button" onClick={submitComm} className="toolbar-btn toolbar-btn-success text-[9px]">Save</button>
              <button type="button" onClick={() => setShowCommForm(false)} className="toolbar-btn text-[9px]">Cancel</button>
            </div>
          </div>
        )}

        {commendations.length > 0 ? (
          <div className="space-y-1">
            {commendations.map((c, i) => (
              <div key={i} className="panel-inset p-2 flex items-start gap-2">
                <Star className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-amber-400 font-bold uppercase">{c.type?.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-rmpg-400">{c.date}</span>
                  </div>
                  <p className="text-[10px] text-rmpg-200">{c.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-rmpg-500 text-center py-2">No commendations recorded</p>
        )}
      </div>
    </div>
  );
}

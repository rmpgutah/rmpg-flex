import ResolutionReviewPanel from '../../components/ResolutionReviewPanel';
import SuggestedLinksPanel from '../../components/SuggestedLinksPanel';

export default function ReviewQueues() {
  return (
    <div className="p-3 space-y-3">
      <div className="font-mono text-[10px] tracking-widest text-fg-muted uppercase">Review Queues</div>
      <SuggestedLinksPanel />
      <ResolutionReviewPanel />
      <div className="text-[10px] text-rmpg-500">Confirm or dismiss suggested links and possible duplicate persons above. Empty queues hide themselves.</div>
    </div>
  );
}

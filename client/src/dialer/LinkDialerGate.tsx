import { Link2 } from 'lucide-react';

// Same-origin /api/* reaches the Worker through the Pages proxy; the SSO
// callback links the Flex account by e-mail and lands back on the SPA.
const SSO_LOGIN_HREF = '/api/oidc/dialer/login';

export default function LinkDialerGate() {
  return (
    <div className="bg-surface-sunken border border-border-subtle p-4 space-y-3 text-[11px] text-rmpg-100" role="status">
      <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--panel-header-color)' }}>Link Dial Connect</div>
      <p className="text-fg-secondary">
        Calls ring the Dial Connect dispatcher account tied to your Flex login. Your account is not linked yet —
        sign in with your Dial Connect e-mail once and this softphone will register automatically.
      </p>
      <a
        href={SSO_LOGIN_HREF}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-accent-silver-500/60 text-rmpg-50 hover:bg-surface-hover text-[10px] font-semibold uppercase tracking-wide"
      >
        <Link2 className="w-3 h-3" /> Sign in with Dialer
      </a>
    </div>
  );
}

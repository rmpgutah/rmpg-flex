import { useState } from 'react';
import { PasswordGate } from './components/PasswordGate';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/ChatPane';

const ENABLE_KIMI_K3 = false;

export function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!authenticated) {
    return <PasswordGate onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div className="app">
      <Sidebar activeId={activeId} onSelect={setActiveId} />
      <main className="main">
        {activeId ? (
          <ChatPane conversationId={activeId} enableKimiK3={ENABLE_KIMI_K3} />
        ) : (
          <div className="empty-state">
            <div className="empty-state__inner">
              <div className="empty-state__glyph">K</div>
              <h2 className="empty-state__title">Start a conversation</h2>
              <p className="empty-state__sub">Select a chat from the sidebar, or start a new one.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

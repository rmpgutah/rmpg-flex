import { useState } from 'react';
import { PasswordGate } from './components/PasswordGate';
import { Sidebar } from './components/Sidebar';

export function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!authenticated) {
    return <PasswordGate onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar activeId={activeId} onSelect={setActiveId} />
      <main>{activeId ? `Chat pane for ${activeId} goes here (Task 12)` : 'Select or start a chat'}</main>
    </div>
  );
}

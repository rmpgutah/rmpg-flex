import { useState } from 'react';
import { PasswordGate } from './components/PasswordGate';

export function App() {
  const [authenticated, setAuthenticated] = useState(false);

  if (!authenticated) {
    return <PasswordGate onSuccess={() => setAuthenticated(true)} />;
  }

  return <div>Authenticated — chat UI goes here (Tasks 11-12)</div>;
}

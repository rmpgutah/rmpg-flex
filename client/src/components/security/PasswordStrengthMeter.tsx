import { useMemo } from 'react';
import { Check, X } from 'lucide-react';

interface Props {
  password: string;
  showRequirements?: boolean;
}

interface Requirement {
  label: string;
  test: (pw: string) => boolean;
}

const requirements: Requirement[] = [
  { label: 'At least 8 characters', test: (pw) => pw.length >= 8 },
  { label: 'Uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'Lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { label: 'Number', test: (pw) => /\d/.test(pw) },
];

function getStrength(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: '', color: '#2a3e58' };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: 'WEAK', color: '#dc2626' };
  if (score === 2) return { score, label: 'FAIR', color: '#d4a017' };
  if (score === 3) return { score, label: 'GOOD', color: '#4a90c4' };
  if (score >= 4) return { score, label: 'STRONG', color: '#22c55e' };
  return { score: 0, label: '', color: '#2a3e58' };
}

export default function PasswordStrengthMeter({ password, showRequirements = true }: Props) {
  const strength = useMemo(() => getStrength(password), [password]);
  const passed = useMemo(() => requirements.filter(r => r.test(password)).length, [password]);

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2" role="status" aria-label={`Password strength: ${strength.label || 'none'}`}>
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 flex gap-0.5">
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className="flex-1 transition-colors duration-300"
              style={{
                background: i <= strength.score ? strength.color : '#1e3048',
              }}
            />
          ))}
        </div>
        {strength.label && (
          <span
            className="text-[9px] font-bold tracking-wider uppercase"
            style={{ color: strength.color }}
          >
            {strength.label}
          </span>
        )}
      </div>

      {/* Requirements checklist */}
      {showRequirements && (
        <div className="grid grid-cols-2 gap-1">
          {requirements.map(req => {
            const met = req.test(password);
            return (
              <div
                key={req.label}
                className="flex items-center gap-1 text-[9px]"
                style={{ color: met ? '#22c55e' : '#6b7280' }}
              >
                {met ? (
                  <Check className="w-2.5 h-2.5" />
                ) : (
                  <X className="w-2.5 h-2.5" />
                )}
                <span>{req.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

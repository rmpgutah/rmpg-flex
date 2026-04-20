import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface Props {
  onClick?: () => void; // optional extra handler (e.g. close parent dropdown)
}

export default function ThemeToggle({ onClick }: Props) {
  const { theme, toggle } = useTheme();
  const Icon = theme === 'dark' ? Moon : Sun;
  const label = theme === 'dark' ? 'Dark Mode' : 'Light Mode';

  return (
    <button
      onClick={() => {
        toggle();
        onClick?.();
      }}
      className="menu-item w-full"
      aria-label={`Switch theme (currently ${label})`}
    >
      <span className="menu-item-icon">
        <Icon style={{ width: 12, height: 12 }} />
      </span>
      <span className="menu-item-label">{label}</span>
    </button>
  );
}

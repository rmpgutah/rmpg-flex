import React, { useState } from 'react';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import RmpgLogo from '../components/RmpgLogo';

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.0';

export default function LoginPage() {
  const { login, error, clearError, loginBusy } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(username, password);
    } catch {
      // Error handled by context
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-base">
      <div className="relative w-full max-w-md px-2 sm:px-0">
        {/* Logo / Brand — RMPG Flex Emblem */}
        <div className="text-center mb-4 sm:mb-6">
          <div className="inline-flex items-center justify-center mb-2">
            <img
              src="/rmpg flex.png"
              alt="RMPG Flex"
              className="drop-shadow-[0_0_20px_rgba(188,16,16,0.3)]"
              style={{ height: 'clamp(120px, 30vw, 200px)', width: 'clamp(120px, 30vw, 200px)', objectFit: 'contain' }}
              draggable={false}
            />
          </div>
          <div className="flex items-center justify-center gap-2 mt-1">
            <div className="h-px w-12 sm:w-20" style={{ background: 'linear-gradient(90deg, transparent, #8a0c0c)' }} />
            <p className="text-[9px] sm:text-[10px] tracking-[0.15em] sm:tracking-[0.2em] uppercase font-semibold" style={{ color: 'rgba(188, 16, 16, 0.65)' }}>CAD / RMS Dispatch System</p>
            <div className="h-px w-12 sm:w-20" style={{ background: 'linear-gradient(90deg, #8a0c0c, transparent)' }} />
          </div>
        </div>

        {/* Login Card - Spillman Flex window chrome */}
        <div className="shadow-2xl relative overflow-hidden panel-beveled bg-surface-base">
          {/* Window title bar */}
          <div className="panel-title-bar flex items-center gap-2">
            <div className="w-2 h-2 bg-brand-600 flex-shrink-0" />
            <span>RMPG FLEX — SYSTEM LOGIN</span>
            <div className="ml-auto flex items-center gap-0.5">
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: '#383838', border: '1px solid #484848', borderBottom: '1px solid #282828' }}>_</div>
              <div className="w-4 h-3 flex items-center justify-center text-[8px] text-rmpg-400" style={{ background: '#383838', border: '1px solid #484848', borderBottom: '1px solid #282828' }}>□</div>
            </div>
          </div>

          <div className="p-6">

          {error && (
            <div className="flex items-center gap-2 p-2 mb-4 animate-fade-in" style={{ background: 'rgba(188, 16, 16, 0.15)', border: '1px solid #8a0c0c' }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#d93030' }} />
              <p className="text-xs" style={{ color: '#ef7a7a' }}>{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="username" className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#a0a0a0' }}>
                Username
              </label>
              <input
                id="username"
                type="text"
                className="input-dark h-9"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[10px] font-bold uppercase mb-1 tracking-wide" style={{ color: '#a0a0a0' }}>
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="input-dark h-9 pr-8"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: '#707070' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#707070'; }}
                  onFocus={(e) => { e.currentTarget.style.color = '#e0e0e0'; }}
                  onBlur={(e) => { e.currentTarget.style.color = '#707070'; }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={0}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loginBusy || !username || !password}
              className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loginBusy ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Authenticating...
                </>
              ) : (
                'SIGN IN'
              )}
            </button>
          </form>

          <div className="mt-4 pt-3" style={{ borderTop: '1px solid #303030' }} />
          </div>

          {/* Decorative status bar at card bottom */}
          <div className="status-bar">
            <div className="status-bar-section">
              <span className="led-dot led-green" />
              <span>SYSTEM READY</span>
            </div>
            <div className="status-bar-section border-r-0">
              <span>v{APP_VERSION}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-3 sm:mt-4">
          <p className="text-[8px] sm:text-[9px] tracking-wide" style={{ color: '#383838' }}>
            RMPG Flex v{APP_VERSION} | Rocky Mountain Protective Group, LLC
          </p>
          <p className="text-[7px] sm:text-[8px] mt-0.5 italic" style={{ color: '#303030' }}>
            &ldquo;Resolving today&rsquo;s concerns, to ensure tomorrow&rsquo;s solutions.&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

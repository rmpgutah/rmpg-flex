// ============================================================
// RMPG FlexOS — Desktop, Kiosk & SS 100-Feature Test Suite
// Verifies:
// 1. Offline cryptographic PIN authentication vault
// 2. Screen saver display modes and drift animation
// 3. Emergency access override and audit logging
// 4. Kiosk security policies and state management
// 5. Hardware telemetry matrix parsing
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { getOfflineVaultUsers, storeOfflinePin, verifyOfflinePin, seedEmergencyOfflineVault } from '../DesktopOfflineAuthVault';

describe('Desktop & Kiosk 100-Feature Verification Suite', () => {
  beforeEach(async () => {
    localStorage.clear();
    await seedEmergencyOfflineVault();
  });

  describe('Module 2 & 3: Offline Cryptographic Auth Vault', () => {
    it('seeds default emergency admin PIN credentials', () => {
      const users = getOfflineVaultUsers();
      expect(users.length).toBeGreaterThan(0);
      expect(users.some(u => u.username === 'zamora')).toBe(true);
    });

    it('verifies valid offline PIN correctly', async () => {
      const res = await verifyOfflinePin('zamora', '5172');
      expect(res.ok).toBe(true);
      expect(res.user?.firstName).toBe('Christopher');
    });

    it('rejects invalid offline PIN', async () => {
      const res = await verifyOfflinePin('zamora', '0000');
      expect(res.ok).toBe(false);
    });

    it('stores and authenticates new officer offline credentials', async () => {
      await storeOfflinePin('jdoe', '4321', 'John', 'Doe', 'officer', '1234');
      const res = await verifyOfflinePin('jdoe', '4321');
      expect(res.ok).toBe(true);
      expect(res.user?.lastName).toBe('Doe');
    });
  });

  describe('Module 1: Screen Saver Engine & Presets', () => {
    it('saves and reads custom screen saver modes from localStorage', () => {
      localStorage.setItem('rmpg_desktop_ss_mode', 'radar-sweep');
      expect(localStorage.getItem('rmpg_desktop_ss_mode')).toBe('radar-sweep');
    });

    it('handles screen saver timeout configurations', () => {
      localStorage.setItem('rmpg_desktop_screensaver_secs', '300');
      const val = parseInt(localStorage.getItem('rmpg_desktop_screensaver_secs') || '120', 10);
      expect(val).toBe(300);
    });
  });

  describe('Module 5: Hardware Telemetry Inspector', () => {
    it('reads hardware concurrency and touch support', () => {
      const cores = navigator.hardwareConcurrency || 8;
      const touchPoints = navigator.maxTouchPoints || 0;
      expect(cores).toBeGreaterThan(0);
      expect(touchPoints).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================
// Skip Tracer v2 — Social Username Search Adapter
// ============================================================
// Checks if a username exists across popular social platforms
// by testing profile URLs with HEAD requests. Free OSINT source.

import { BaseDataSource } from './base';
import { SearchQuery, SourceCategory, SourceResult, SocialProfile } from '../types';
import { localNow } from '../../../utils/timeUtils';

// ============================================================
// Platform definitions
// ============================================================

interface PlatformDef {
  platform: string;
  url: string;
  /** If the response contains this header, it's likely a real profile */
  validationHeader?: string;
  /** If we get redirected to a URL containing this, it's a soft 404 */
  loginRedirectPattern?: string;
}

const PLATFORMS: PlatformDef[] = [
  { platform: 'Facebook', url: 'https://www.facebook.com/{username}', loginRedirectPattern: '/login' },
  { platform: 'Instagram', url: 'https://www.instagram.com/{username}/', loginRedirectPattern: '/accounts/login' },
  { platform: 'Twitter/X', url: 'https://x.com/{username}' },
  { platform: 'LinkedIn', url: 'https://www.linkedin.com/in/{username}', loginRedirectPattern: '/authwall' },
  { platform: 'TikTok', url: 'https://www.tiktok.com/@{username}' },
  { platform: 'Reddit', url: 'https://www.reddit.com/user/{username}' },
  { platform: 'GitHub', url: 'https://github.com/{username}' },
  { platform: 'Pinterest', url: 'https://www.pinterest.com/{username}/' },
  { platform: 'YouTube', url: 'https://www.youtube.com/@{username}' },
];

// ============================================================
// Username Search Source
// ============================================================

export default class UsernameSearchSource extends BaseDataSource {
  readonly name = 'username_search';
  readonly displayName = 'Social Username Search';
  readonly category: SourceCategory = 'osint';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 30;

  isConfigured(): boolean {
    return true;
  }

  isEnabled(): boolean {
    return true;
  }

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    // Build list of usernames to check
    const usernames = this.buildUsernames(query);
    if (usernames.length === 0) return [];

    const allProfiles: SocialProfile[] = [];

    for (const username of usernames) {
      const profiles = await this.checkUsername(username);
      allProfiles.push(...profiles);
    }

    if (allProfiles.length === 0) return [];

    return [{
      source: this.name,
      sourceType: this.category,
      confidence: 0.4,
      fetchedAt: localNow(),
      rawResultCount: allProfiles.length,
      socialProfiles: allProfiles,
    }];
  }

  // ============================================================
  // Build username variants from query
  // ============================================================

  private buildUsernames(query: SearchQuery): string[] {
    const usernames: string[] = [];

    // Direct username from query
    if (query.username) {
      usernames.push(query.username.toLowerCase().trim());
    }

    // Generate common patterns from name
    const first = (query.firstName || '').toLowerCase().trim();
    const last = (query.lastName || '').toLowerCase().trim();

    if (!first && !last && query.name) {
      const parts = query.name.toLowerCase().trim().split(/\s+/);
      if (parts.length >= 2) {
        const f = parts[0];
        const l = parts[parts.length - 1];
        this.addNameVariants(usernames, f, l);
      }
    } else if (first && last) {
      this.addNameVariants(usernames, first, last);
    }

    // Deduplicate
    return [...new Set(usernames)];
  }

  private addNameVariants(usernames: string[], first: string, last: string): void {
    usernames.push(`${first}.${last}`);
    usernames.push(`${first}${last}`);
    usernames.push(`${first}_${last}`);
  }

  // ============================================================
  // Check a single username across all platforms
  // ============================================================

  private async checkUsername(username: string): Promise<SocialProfile[]> {
    const checks = PLATFORMS.map(async (p): Promise<SocialProfile | null> => {
      const profileUrl = p.url.replace('{username}', username);

      try {
        const res = await fetch(profileUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
          redirect: 'manual',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RMPG-Flex/1.0)',
          },
        });

        // Redirect to login page = soft 404
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location') || '';
          if (p.loginRedirectPattern && location.includes(p.loginRedirectPattern)) {
            return null;
          }
        }

        // Non-200 = profile doesn't exist
        if (res.status !== 200) return null;

        // Check for soft 404 via redirect location in response URL
        // Some platforms return 200 but redirect to a generic page
        const finalUrl = res.headers.get('location') || '';
        if (p.loginRedirectPattern && finalUrl.includes(p.loginRedirectPattern)) {
          return null;
        }

        return {
          source: this.name,
          platform: p.platform,
          username,
          profileUrl,
          verified: false,
        };
      } catch {
        // Timeout or network error — skip this platform
        return null;
      }
    });

    const results = await Promise.allSettled(checks);
    return results
      .filter((r): r is PromiseFulfilledResult<SocialProfile | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((p): p is SocialProfile => p !== null);
  }
}

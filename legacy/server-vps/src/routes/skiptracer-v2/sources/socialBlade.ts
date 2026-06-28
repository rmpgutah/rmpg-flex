// ============================================================
// Skip Tracker 3.5 — Social Blade / Social Stats Adapter
// ============================================================
// Looks up public social media statistics for YouTube, TikTok,
// and Instagram accounts using public endpoints. Returns
// socialProfiles with follower counts and account estimates.
// Free OSINT source — no API key required.

import { BaseDataSource } from './base';
import { SearchQuery, SkipTracerSourceCategory, SourceResult, SocialProfile } from '../types';
import { localNow } from '../../../utils/timeUtils';

const USER_AGENT = 'Mozilla/5.0 (compatible; RMPG-Flex/1.0)';

interface PlatformCheck {
  platform: string;
  buildUrl: (username: string) => string;
  parseProfile: (html: string, username: string, source: string) => SocialProfile | null;
}

export default class SocialBladeSource extends BaseDataSource {
  readonly name = 'social_blade';
  readonly displayName = 'Social Media Stats';
  readonly category: SkipTracerSourceCategory = 'osint';
  readonly costPerLookup = 0;

  protected maxRequestsPerMinute = 10;

  isConfigured(): boolean {
    return true;
  }

  isEnabled(): boolean {
    return true;
  }

  private readonly platforms: PlatformCheck[] = [
    {
      platform: 'YouTube',
      buildUrl: (u: string) => `https://www.youtube.com/@${u}`,
      parseProfile: this.parseYouTube.bind(this),
    },
    {
      platform: 'TikTok',
      buildUrl: (u: string) => `https://www.tiktok.com/@${u}`,
      parseProfile: this.parseTikTok.bind(this),
    },
    {
      platform: 'Instagram',
      buildUrl: (u: string) => `https://www.instagram.com/${u}/`,
      parseProfile: this.parseInstagram.bind(this),
    },
  ];

  protected async doSearch(query: SearchQuery): Promise<SourceResult[]> {
    try {
      const usernames = this.buildUsernames(query);
      if (usernames.length === 0) return [];

      const allProfiles: SocialProfile[] = [];

      for (const username of usernames) {
        const profiles = await this.checkAllPlatforms(username);
        allProfiles.push(...profiles);
      }

      if (allProfiles.length === 0) return [];

      return [{
        source: this.name,
        sourceType: this.category,
        confidence: 0.3,
        fetchedAt: localNow(),
        rawResultCount: allProfiles.length,
        socialProfiles: allProfiles,
      }];
    } catch (err) {
      console.error('[SocialBladeSource] Search error:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  // ============================================================
  // Username generation from query
  // ============================================================

  private buildUsernames(query: SearchQuery): string[] {
    const usernames: string[] = [];

    if (query.username) {
      usernames.push(query.username.toLowerCase().trim());
    }

    const first = (query.firstName || '').toLowerCase().trim();
    const last = (query.lastName || '').toLowerCase().trim();

    if (!first && !last && query.name) {
      const parts = query.name.toLowerCase().trim().split(/\s+/);
      if (parts.length >= 2) {
        const f = parts[0];
        const l = parts[parts.length - 1];
        usernames.push(`${f}${l}`, `${f}.${l}`, `${f}_${l}`);
      }
    } else if (first && last) {
      usernames.push(`${first}${last}`, `${first}.${last}`, `${first}_${last}`);
    }

    return [...new Set(usernames)].slice(0, 3); // Limit to 3 variants
  }

  // ============================================================
  // Check all platforms for a given username
  // ============================================================

  private async checkAllPlatforms(username: string): Promise<SocialProfile[]> {
    const checks = this.platforms.map(async (p): Promise<SocialProfile | null> => {
      try {
        const url = p.buildUrl(username);
        const res = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(8000),
          redirect: 'follow',
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html',
          },
        });

        // Non-200 = profile likely doesn't exist
        if (!res.ok) return null;

        const html = await res.text();

        // Check for soft 404s (redirects to login, search, etc.)
        if (this.isSoft404(html, p.platform)) return null;

        return p.parseProfile(html, username, this.name);
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(checks);
    return results
      .filter((r): r is PromiseFulfilledResult<SocialProfile | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((p): p is SocialProfile => p !== null);
  }

  // ============================================================
  // Soft 404 detection
  // ============================================================

  private isSoft404(html: string, platform: string): boolean {
    const lower = html.toLowerCase();

    // Common soft 404 indicators
    if (lower.includes('page not found') || lower.includes('this page isn\'t available')) return true;
    if (lower.includes('sorry, this page') || lower.includes('user not found')) return true;

    // Platform-specific
    if (platform === 'Instagram' && lower.includes('login to instagram')) return true;
    if (platform === 'TikTok' && lower.includes('couldn\'t find this account')) return true;
    if (platform === 'YouTube' && lower.includes('this page isn\'t available')) return true;

    return false;
  }

  // ============================================================
  // Platform-specific HTML parsers
  // ============================================================

  private parseYouTube(html: string, username: string, source: string): SocialProfile | null {
    try {
      // Extract subscriber count from meta or JSON-LD
      let followers: number | undefined;

      // Try og:description or meta tags that mention subscribers
      const subMatch = html.match(/(\d[\d,.]*[KMB]?)\s*subscribers?/i);
      if (subMatch) {
        followers = this.parseCount(subMatch[1]);
      }

      // Try JSON-LD for channel name
      let displayName: string | undefined;
      const nameMatch = html.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch) {
        displayName = nameMatch[1];
      }

      // Try og:title
      if (!displayName) {
        const ogMatch = html.match(/property="og:title"\s+content="([^"]+)"/);
        if (ogMatch) displayName = ogMatch[1];
      }

      // Extract join date if available
      let lastActive: string | undefined;
      const joinMatch = html.match(/Joined\s+([\w\s]+\d{4})/i);
      if (joinMatch) {
        lastActive = joinMatch[1];
      }

      // If we found nothing useful, this might not be a real profile
      if (!followers && !displayName) return null;

      return {
        source,
        platform: 'YouTube',
        username,
        displayName,
        profileUrl: `https://www.youtube.com/@${username}`,
        followers,
        lastActive,
        verified: false,
      };
    } catch {
      return null;
    }
  }

  private parseTikTok(html: string, username: string, source: string): SocialProfile | null {
    try {
      let followers: number | undefined;
      let displayName: string | undefined;
      let bio: string | undefined;

      // TikTok embeds user data in JSON within the page
      const statsMatch = html.match(/"followerCount"\s*:\s*(\d+)/);
      if (statsMatch) {
        followers = parseInt(statsMatch[1], 10);
      }

      // Try meta tags for follower count
      if (!followers) {
        const metaMatch = html.match(/(\d[\d,.]*[KMB]?)\s*Followers/i);
        if (metaMatch) {
          followers = this.parseCount(metaMatch[1]);
        }
      }

      // Display name
      const nameMatch = html.match(/"nickname"\s*:\s*"([^"]+)"/);
      if (nameMatch) {
        displayName = nameMatch[1];
      }

      // Bio/signature
      const bioMatch = html.match(/"signature"\s*:\s*"([^"]+)"/);
      if (bioMatch) {
        bio = bioMatch[1];
      }

      if (!followers && !displayName) return null;

      return {
        source,
        platform: 'TikTok',
        username,
        displayName,
        profileUrl: `https://www.tiktok.com/@${username}`,
        bio,
        followers,
        verified: false,
      };
    } catch {
      return null;
    }
  }

  private parseInstagram(html: string, username: string, source: string): SocialProfile | null {
    try {
      let followers: number | undefined;
      let displayName: string | undefined;
      let bio: string | undefined;

      // Instagram meta description often contains follower count
      const descMatch = html.match(/content="(\d[\d,.]*[KMB]?)\s*Followers/i);
      if (descMatch) {
        followers = this.parseCount(descMatch[1]);
      }

      // Try JSON data
      const jsonFollowers = html.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
      if (jsonFollowers) {
        followers = parseInt(jsonFollowers[1], 10);
      }

      // Display name from og:title
      const titleMatch = html.match(/property="og:title"\s+content="([^"(]+)/);
      if (titleMatch) {
        displayName = titleMatch[1].trim();
      }

      // Bio from og:description
      const bioMatch = html.match(/property="og:description"\s+content="[^"]*?-\s*([^"]+)"/);
      if (bioMatch) {
        bio = bioMatch[1].trim();
      }

      if (!followers && !displayName) return null;

      return {
        source,
        platform: 'Instagram',
        username,
        displayName,
        profileUrl: `https://www.instagram.com/${username}/`,
        bio,
        followers,
        verified: false,
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private parseCount(raw: string): number {
    const cleaned = raw.replace(/,/g, '');
    const multiplierMatch = cleaned.match(/([\d.]+)\s*([KMB])/i);
    if (multiplierMatch) {
      const num = parseFloat(multiplierMatch[1]);
      const suffix = multiplierMatch[2].toUpperCase();
      if (suffix === 'K') return Math.round(num * 1_000);
      if (suffix === 'M') return Math.round(num * 1_000_000);
      if (suffix === 'B') return Math.round(num * 1_000_000_000);
    }
    return parseInt(cleaned, 10) || 0;
  }
}

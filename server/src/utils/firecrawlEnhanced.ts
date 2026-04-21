// ============================================================
// Firecrawl Enhanced Utilities
// ============================================================
// Advanced analysis functions using cheerio, natural, sentiment,
// csv-stringify, whois-json, and rss-parser for the Overwatch
// Firecrawl tools routes.
// ============================================================

import * as cheerio from 'cheerio';
import Sentiment from 'sentiment';
import natural from 'natural';
import { stringify } from 'csv-stringify/sync';
import whoisJson from 'whois-json';
import RssParser from 'rss-parser';

const sentimentAnalyzer = new Sentiment();
const tokenizer = new natural.WordTokenizer();
const TfIdf = natural.TfIdf;
const rssParser = new RssParser();

// ── 1. Sentiment Analysis ────────────────────────────────────

export function analyzeSentiment(text: string): {
  score: number;
  comparative: number;
  label: 'positive' | 'negative' | 'neutral';
  tokens: number;
} {
  const result = sentimentAnalyzer.analyze(text);
  const tokens = tokenizer.tokenize(text)?.length || 0;
  let label: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (result.comparative > 0.05) label = 'positive';
  else if (result.comparative < -0.05) label = 'negative';

  return {
    score: result.score,
    comparative: Math.round(result.comparative * 1000) / 1000,
    label,
    tokens,
  };
}

// ── 2. TF-IDF Keyword Extraction ────────────────────────────

export function extractKeywords(
  text: string,
  maxKeywords: number = 15,
): { term: string; tfidf: number }[] {
  const tfidf = new TfIdf();
  tfidf.addDocument(text);

  const results: { term: string; tfidf: number }[] = [];
  tfidf.listTerms(0).forEach((item) => {
    if (item.term.length > 2 && results.length < maxKeywords) {
      results.push({
        term: item.term,
        tfidf: Math.round(item.tfidf * 1000) / 1000,
      });
    }
  });

  return results;
}

// ── 3. Extract Contact Info from HTML ───────────────────────

export function extractContactInfo(html: string): {
  emails: string[];
  phones: string[];
  addresses: string[];
  socialLinks: { platform: string; url: string }[];
} {
  const $ = cheerio.load(html);
  const text = $('body').text();

  // Extract emails
  const emailRegex = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  const rawEmails = text.match(emailRegex) || [];
  const emails = [...new Set(rawEmails)].filter(
    (e) => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif'),
  );

  // Extract US phone numbers
  const phoneRegex = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
  const rawPhones = text.match(phoneRegex) || [];
  const phones = [...new Set(rawPhones.map((p) => p.trim()))].filter(
    (p) => p.replace(/\D/g, '').length >= 10,
  );

  // Extract addresses (simple US format patterns)
  const addressRegex = /\d+\s+[\w\s]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place)[.,]?\s*(?:Suite|Ste|#|Apt)?\s*\d*[,.]?\s*[\w\s]+,?\s*[A-Z]{2}\s*\d{5}/gi;
  const rawAddresses = text.match(addressRegex) || [];
  const addresses = [...new Set(rawAddresses.map((a) => a.trim()))];

  // Extract social media links using cheerio
  const socialLinks: { platform: string; url: string }[] = [];
  // Host-boundary anchors (?:[/?#]|$) prevent matches like
  // "linkedin.com.evil.com" — without it, the host portion is unbounded.
  const socialPatterns: [string, RegExp][] = [
    ['linkedin', /^https?:\/\/(?:www\.)?linkedin\.com(?:[/?#]|$)/i],
    ['twitter', /^https?:\/\/(?:www\.)?(?:twitter|x)\.com(?:[/?#]|$)/i],
    ['facebook', /^https?:\/\/(?:www\.)?facebook\.com(?:[/?#]|$)/i],
    ['instagram', /^https?:\/\/(?:www\.)?instagram\.com(?:[/?#]|$)/i],
    ['youtube', /^https?:\/\/(?:www\.)?youtube\.com(?:[/?#]|$)/i],
    ['github', /^https?:\/\/(?:www\.)?github\.com(?:[/?#]|$)/i],
    ['tiktok', /^https?:\/\/(?:www\.)?tiktok\.com(?:[/?#]|$)/i],
  ];

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    for (const [platform, regex] of socialPatterns) {
      if (regex.test(href) && !socialLinks.some((s) => s.url === href)) {
        socialLinks.push({ platform, url: href });
        break;
      }
    }
  });

  return { emails, phones, addresses, socialLinks };
}

// ── 4. Extract Business Info from HTML ──────────────────────

export function extractBusinessInfo(
  html: string,
  url: string,
): {
  name?: string;
  description?: string;
  industry?: string;
  address?: string;
  phone?: string;
  email?: string;
  socialLinks: { platform: string; url: string }[];
} {
  const $ = cheerio.load(html);
  let name: string | undefined;
  let description: string | undefined;
  let industry: string | undefined;
  let address: string | undefined;
  let phone: string | undefined;
  let email: string | undefined;
  const socialLinks: { platform: string; url: string }[] = [];

  // Try schema.org JSON-LD first
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const data = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Organization' || item['@type'] === 'LocalBusiness' || item['@type'] === 'Corporation') {
          name = name || item.name;
          description = description || item.description;
          industry = industry || item.industry;
          if (item.address) {
            if (typeof item.address === 'string') {
              address = item.address;
            } else if (item.address.streetAddress) {
              address = [item.address.streetAddress, item.address.addressLocality, item.address.addressRegion, item.address.postalCode]
                .filter(Boolean).join(', ');
            }
          }
          phone = phone || item.telephone;
          email = email || item.email;
          if (item.sameAs) {
            const links = Array.isArray(item.sameAs) ? item.sameAs : [item.sameAs];
            for (const link of links) {
              if (typeof link === 'string') {
                const platform = detectSocialPlatform(link);
                if (platform) socialLinks.push({ platform, url: link });
              }
            }
          }
        }
      }
    } catch { /* skip malformed JSON-LD */ }
  });

  // Fallback to Open Graph tags
  if (!name) name = $('meta[property="og:site_name"]').attr('content')?.trim();
  if (!name) name = $('meta[property="og:title"]').attr('content')?.trim();
  if (!name) name = $('title').first().text().trim();
  if (!description) description = $('meta[property="og:description"]').attr('content')?.trim();
  if (!description) description = $('meta[name="description"]').attr('content')?.trim();

  // Extract contact info from page
  const contact = extractContactInfo(html);
  if (!email && contact.emails.length > 0) email = contact.emails[0];
  if (!phone && contact.phones.length > 0) phone = contact.phones[0];
  if (!address && contact.addresses.length > 0) address = contact.addresses[0];
  if (socialLinks.length === 0) socialLinks.push(...contact.socialLinks);

  // Detect industry from content keywords
  if (!industry) {
    const text = $('body').text().toLowerCase();
    const industryKeywords: Record<string, string[]> = {
      'Technology': ['software', 'saas', 'platform', 'api', 'developer', 'tech', 'cloud'],
      'E-commerce': ['shop', 'store', 'buy', 'cart', 'ecommerce', 'product', 'price'],
      'Finance': ['bank', 'financial', 'invest', 'insurance', 'fintech', 'loan'],
      'Healthcare': ['health', 'medical', 'patient', 'care', 'clinical', 'doctor'],
      'Education': ['learn', 'course', 'education', 'university', 'school', 'student'],
      'Media': ['news', 'media', 'publish', 'content', 'journalism', 'article'],
      'Real Estate': ['property', 'real estate', 'listing', 'mortgage', 'rent', 'apartment'],
      'Legal': ['attorney', 'lawyer', 'legal', 'law firm', 'counsel'],
      'Restaurant': ['menu', 'restaurant', 'dining', 'food', 'reservation'],
      'Security': ['security', 'protection', 'guard', 'patrol', 'surveillance'],
    };
    let maxMatches = 0;
    for (const [ind, kws] of Object.entries(industryKeywords)) {
      const matches = kws.filter((kw) => text.includes(kw)).length;
      if (matches > maxMatches) { maxMatches = matches; industry = ind; }
    }
  }

  return { name, description, industry, address, phone, email, socialLinks };
}

function detectSocialPlatform(url: string): string | null {
  // Host-boundary anchors (?:[/?#]|$) prevent matches like "linkedin.com.evil.com".
  if (/^https?:\/\/(?:www\.)?linkedin\.com(?:[/?#]|$)/i.test(url)) return 'linkedin';
  if (/^https?:\/\/(?:www\.)?(?:twitter|x)\.com(?:[/?#]|$)/i.test(url)) return 'twitter';
  if (/^https?:\/\/(?:www\.)?facebook\.com(?:[/?#]|$)/i.test(url)) return 'facebook';
  if (/^https?:\/\/(?:www\.)?instagram\.com(?:[/?#]|$)/i.test(url)) return 'instagram';
  if (/^https?:\/\/(?:www\.)?youtube\.com(?:[/?#]|$)/i.test(url)) return 'youtube';
  if (/^https?:\/\/(?:www\.)?github\.com(?:[/?#]|$)/i.test(url)) return 'github';
  if (/^https?:\/\/(?:www\.)?tiktok\.com(?:[/?#]|$)/i.test(url)) return 'tiktok';
  return null;
}

// ── 5. WHOIS Lookup ─────────────────────────────────────────

export async function lookupWhois(domain: string): Promise<{
  registrar?: string;
  creation_date?: string;
  expiration_date?: string;
  name_servers?: string[];
  registrant_org?: string;
  status?: string;
}> {
  try {
    // Clean domain (strip protocol, path)
    const cleaned = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    const result = await whoisJson(cleaned);

    // whois-json may return an array or object depending on the TLD
    const data = Array.isArray(result) ? result[0] : result;
    if (!data) return {};

    const nameServers = (data.nameServer || data.name_server || '');
    const nsArray = typeof nameServers === 'string'
      ? nameServers.split(/[\n,]/).map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      : Array.isArray(nameServers) ? nameServers : [];

    return {
      registrar: data.registrar || data.registrarName || undefined,
      creation_date: data.creationDate || data.created || data.registrationDate || undefined,
      expiration_date: data.expirationDate || data.registryExpiryDate || data.expiresDate || undefined,
      name_servers: nsArray.length > 0 ? nsArray : undefined,
      registrant_org: data.registrantOrganization || data.registrantName || undefined,
      status: data.domainStatus || data.status || undefined,
    };
  } catch (err) {
    console.error('[firecrawlEnhanced] WHOIS lookup failed:', err instanceof Error ? err.message : err);
    return {};
  }
}

// ── 6. RSS Feed Parser ──────────────────────────────────────

export async function parseRssFeed(url: string): Promise<{
  title: string;
  items: { title: string; link: string; pubDate?: string; contentSnippet?: string }[];
}> {
  try {
    const feed = await rssParser.parseURL(url);
    return {
      title: feed.title || '',
      items: (feed.items || []).map((item) => ({
        title: item.title || '',
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || undefined,
        contentSnippet: (item.contentSnippet || item.content || '').substring(0, 500),
      })),
    };
  } catch (err) {
    console.error('[firecrawlEnhanced] RSS parse failed:', err instanceof Error ? err.message : err);
    return { title: '', items: [] };
  }
}

// ── 7. CSV Generation ───────────────────────────────────────

export function toCsv(data: Record<string, any>[]): string {
  if (data.length === 0) return '';
  return stringify(data, { header: true });
}

// ── 8. AI-Readiness Analyzer (cheerio-based) ────────────────

export function analyzeAiReadiness(
  html: string,
  url: string,
): {
  scores: Record<string, number>;
  overall: number;
  recommendations: string[];
} {
  const $ = cheerio.load(html);
  const scores: Record<string, number> = {
    structured_data: 0,
    semantic_html: 0,
    content_quality: 0,
    performance: 0,
    api_availability: 0,
    mobile_friendly: 0,
    accessibility: 0,
    security: 0,
  };
  const recommendations: string[] = [];

  // ── Structured Data ──
  const jsonLdScripts = $('script[type="application/ld+json"]');
  if (jsonLdScripts.length > 0) scores.structured_data += 40;
  let hasSchemaOrg = false;
  jsonLdScripts.each((_i, el) => {
    const content = $(el).html() || '';
    if (content.includes('schema.org')) hasSchemaOrg = true;
  });
  if (hasSchemaOrg) scores.structured_data += 20;
  if ($('[itemscope]').length > 0 || $('[itemprop]').length > 0) scores.structured_data += 20;
  if ($('meta[property^="og:"]').length > 0) scores.structured_data += 10;
  if ($('meta[name^="twitter:"]').length > 0) scores.structured_data += 10;
  scores.structured_data = Math.min(scores.structured_data, 100);
  if (scores.structured_data < 50) recommendations.push('Add JSON-LD structured data (schema.org) for better AI discoverability');

  // ── Semantic HTML ──
  if ($('header').length > 0) scores.semantic_html += 12;
  if ($('nav').length > 0) scores.semantic_html += 12;
  if ($('main').length > 0) scores.semantic_html += 15;
  if ($('article').length > 0) scores.semantic_html += 12;
  if ($('footer').length > 0) scores.semantic_html += 8;
  if ($('section').length > 0) scores.semantic_html += 6;
  // Check heading hierarchy
  const h1Count = $('h1').length;
  if (h1Count === 1) scores.semantic_html += 15; // Exactly one h1 is ideal
  else if (h1Count > 0) scores.semantic_html += 8;
  if ($('h2').length > 0) scores.semantic_html += 5;
  if ($('[aria-label], [aria-labelledby], [aria-describedby]').length > 0) scores.semantic_html += 15;
  scores.semantic_html = Math.min(scores.semantic_html, 100);
  if (scores.semantic_html < 50) recommendations.push('Use semantic HTML5 elements (header, nav, main, article, footer) and proper h1-h6 hierarchy');

  // ── Content Quality ──
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  if (metaDesc.length > 0) scores.content_quality += 20;
  if (metaDesc.length >= 50 && metaDesc.length <= 160) scores.content_quality += 5;
  if ($('meta[property="og:title"]').length > 0) scores.content_quality += 10;
  if ($('meta[property="og:description"]').length > 0) scores.content_quality += 10;
  if ($('meta[property="og:image"]').length > 0) scores.content_quality += 5;
  if ($('title').text().trim().length > 0) scores.content_quality += 15;
  if ($('link[rel="canonical"]').length > 0) scores.content_quality += 10;
  // Alt text ratio on images
  const totalImages = $('img').length;
  const imagesWithAlt = $('img[alt]').filter((_i, el) => ($(el).attr('alt') || '').trim().length > 0).length;
  if (totalImages > 0) {
    const altRatio = imagesWithAlt / totalImages;
    scores.content_quality += Math.round(altRatio * 25);
  } else {
    scores.content_quality += 15; // No images = no alt text issue
  }
  scores.content_quality = Math.min(scores.content_quality, 100);
  if (scores.content_quality < 50) recommendations.push('Add meta descriptions, OG tags, image alt text, and canonical URLs');

  // ── Performance ──
  const pageSize = html.length;
  if (pageSize < 100_000) scores.performance = 80;
  else if (pageSize < 300_000) scores.performance = 60;
  else if (pageSize < 500_000) scores.performance = 35;
  else scores.performance = 15;
  const inlineStyleCount = $('[style]').length;
  if (inlineStyleCount < 10) scores.performance += 10;
  else if (inlineStyleCount < 50) scores.performance += 5;
  const scriptCount = $('script').length;
  if (scriptCount < 10) scores.performance += 10;
  else if (scriptCount < 25) scores.performance += 5;
  if ($('img[loading="lazy"]').length > 0) scores.performance += 5;
  scores.performance = Math.min(scores.performance, 100);
  if (scores.performance < 50) recommendations.push('Reduce page size, minimize inline styles, and implement lazy loading');

  // ── API Availability ──
  const bodyText = $('body').text().toLowerCase();
  const allHrefs = $('a[href]').map((_i, el) => $(el).attr('href') || '').get().join(' ').toLowerCase();
  const combined = bodyText + ' ' + allHrefs;
  if (combined.includes('/api/') || combined.includes('/api.')) scores.api_availability += 35;
  if (combined.includes('openapi') || combined.includes('swagger')) scores.api_availability += 30;
  if (combined.includes('graphql')) scores.api_availability += 20;
  if (combined.includes('developer') && combined.includes('documentation')) scores.api_availability += 15;
  scores.api_availability = Math.min(scores.api_availability, 100);
  if (scores.api_availability < 30) recommendations.push('Consider exposing a public API or OpenAPI specification');

  // ── Mobile Friendly ──
  if ($('meta[name="viewport"]').length > 0) scores.mobile_friendly += 40;
  // Check for responsive meta viewport content
  const viewportContent = $('meta[name="viewport"]').attr('content') || '';
  if (viewportContent.includes('width=device-width')) scores.mobile_friendly += 15;
  if ($('style').text().includes('@media') || html.includes('@media')) scores.mobile_friendly += 20;
  if ($('link[media]').length > 0) scores.mobile_friendly += 10;
  if ($('picture').length > 0 || $('source[media]').length > 0) scores.mobile_friendly += 15;
  scores.mobile_friendly = Math.min(scores.mobile_friendly, 100);
  if (scores.mobile_friendly < 50) recommendations.push('Add viewport meta tag and responsive design with @media queries');

  // ── Accessibility ──
  const ariaCount = $('[aria-label], [aria-labelledby], [aria-describedby], [aria-hidden], [role]').length;
  if (ariaCount > 0) scores.accessibility += Math.min(ariaCount * 5, 30);
  if ($('html[lang]').length > 0) scores.accessibility += 20;
  if ($('label').length > 0) scores.accessibility += 10;
  if ($('[tabindex]').length > 0) scores.accessibility += 10;
  if ($('a[href]:not([tabindex="-1"])').length > 0) scores.accessibility += 5;
  // Alt text ratio contributes here too
  if (totalImages > 0 && imagesWithAlt / totalImages > 0.8) scores.accessibility += 15;
  else if (totalImages === 0) scores.accessibility += 10;
  if ($('skip-nav, [class*="skip"], a[href="#main"], a[href="#content"]').length > 0) scores.accessibility += 10;
  scores.accessibility = Math.min(scores.accessibility, 100);
  if (scores.accessibility < 50) recommendations.push('Improve accessibility: add ARIA attributes, lang tag, form labels, and alt text');

  // ── Security ──
  if (url.startsWith('https')) scores.security += 50;
  // Check for security-related meta/headers in HTML
  if (html.includes('content-security-policy') || html.includes('Content-Security-Policy')) scores.security += 20;
  if (html.includes('strict-transport-security') || html.includes('Strict-Transport-Security')) scores.security += 15;
  if (html.includes('x-frame-options') || html.includes('X-Frame-Options')) scores.security += 10;
  if (html.includes('referrer-policy') || html.includes('Referrer-Policy')) scores.security += 5;
  scores.security = Math.min(scores.security, 100);
  if (scores.security < 50) recommendations.push('Ensure HTTPS and add security headers (CSP, HSTS, X-Frame-Options)');

  const values = Object.values(scores);
  const overall = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return { scores, overall, recommendations };
}

// ── 9. Extract Tables from HTML ─────────────────────────────

export function extractTables(html: string): { headers: string[]; rows: string[][] }[] {
  const $ = cheerio.load(html);
  const tables: { headers: string[]; rows: string[][] }[] = [];

  $('table').each((_i, tableEl) => {
    const $table = $(tableEl);
    const headers: string[] = [];
    const rows: string[][] = [];

    // Extract headers from thead or first row
    $table.find('thead th, thead td').each((_j, th) => {
      headers.push($(th).text().trim());
    });

    // If no thead, try first tr
    if (headers.length === 0) {
      const firstRow = $table.find('tr').first();
      firstRow.find('th, td').each((_j, cell) => {
        headers.push($(cell).text().trim());
      });
    }

    // Extract body rows
    const bodyRows = headers.length > 0 && $table.find('thead').length > 0
      ? $table.find('tbody tr')
      : $table.find('tr').slice(1); // Skip header row

    bodyRows.each((_j, tr) => {
      const row: string[] = [];
      $(tr).find('td, th').each((_k, cell) => {
        row.push($(cell).text().trim());
      });
      if (row.length > 0) rows.push(row);
    });

    if (headers.length > 0 || rows.length > 0) {
      tables.push({ headers, rows });
    }
  });

  return tables;
}

// ── 10. Compare Two HTML Pages ──────────────────────────────

export function comparePages(
  htmlA: string,
  htmlB: string,
): {
  sections_added: string[];
  sections_removed: string[];
  sections_changed: string[];
  similarity_score: number;
} {
  const $a = cheerio.load(htmlA);
  const $b = cheerio.load(htmlB);

  // Extract text sections from each page
  function extractSections($: cheerio.CheerioAPI): Map<string, string> {
    const sections = new Map<string, string>();
    // Try headings as section markers
    $('h1, h2, h3, h4, h5, h6').each((_i, el) => {
      const heading = $(el).text().trim();
      if (!heading) return;
      // Get the text content following this heading until the next heading
      let content = '';
      let next = $(el).next();
      while (next.length > 0 && !next.is('h1, h2, h3, h4, h5, h6')) {
        content += next.text().trim() + ' ';
        next = next.next();
      }
      sections.set(heading, content.trim());
    });

    // Also extract major structural sections
    $('section, article, main, div[id], div[class]').each((_i, el) => {
      const id = $(el).attr('id') || $(el).attr('class')?.split(' ')[0] || '';
      if (id && !sections.has(id)) {
        sections.set(`[${$(el).prop('tagName')?.toLowerCase()}#${id}]`, $(el).text().trim().substring(0, 500));
      }
    });

    return sections;
  }

  const sectionsA = extractSections($a);
  const sectionsB = extractSections($b);

  const sections_added: string[] = [];
  const sections_removed: string[] = [];
  const sections_changed: string[] = [];

  // Find sections added in B
  for (const key of sectionsB.keys()) {
    if (!sectionsA.has(key)) sections_added.push(key);
  }

  // Find sections removed from A
  for (const key of sectionsA.keys()) {
    if (!sectionsB.has(key)) sections_removed.push(key);
  }

  // Find changed sections
  for (const [key, contentA] of sectionsA.entries()) {
    const contentB = sectionsB.get(key);
    if (contentB !== undefined && contentA !== contentB) {
      sections_changed.push(key);
    }
  }

  // Calculate text similarity using Jaro-Winkler distance
  const textA = $a('body').text().trim().substring(0, 10_000);
  const textB = $b('body').text().trim().substring(0, 10_000);

  let similarity_score = 0;
  if (textA.length > 0 && textB.length > 0) {
    // Use natural's Jaro-Winkler for similarity
    similarity_score = Math.round(natural.JaroWinklerDistance(textA, textB) * 100);
  } else if (textA.length === 0 && textB.length === 0) {
    similarity_score = 100;
  }

  return { sections_added, sections_removed, sections_changed, similarity_score };
}

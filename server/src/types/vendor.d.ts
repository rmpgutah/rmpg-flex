// Type declarations for packages without bundled types

declare module 'sentiment' {
  interface SentimentResult {
    score: number;
    comparative: number;
    tokens: string[];
    words: string[];
    positive: string[];
    negative: string[];
  }
  class Sentiment {
    analyze(phrase: string, opts?: Record<string, any>): SentimentResult;
  }
  export default Sentiment;
}

declare module 'whois-json' {
  function whoisJson(domain: string, opts?: Record<string, any>): Promise<Record<string, any>>;
  export default whoisJson;
}

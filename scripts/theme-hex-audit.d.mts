// Type declarations for the plain-JS theme-hex-audit script so the TS test
// suite (tsconfig.test.json includes tests/**) can import it without TS7016.
export declare const ALLOWED_HEX: Set<string>;
export declare function findDisallowedHex(text: string): string[];
export declare function listClientFiles(): string[];

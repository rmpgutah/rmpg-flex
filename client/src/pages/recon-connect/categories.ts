import { Search, Globe, Wifi, Lock, Eye, Bug, Server, Cloud, Smartphone, FileSearch, Radio, KeyRound, Database, Users, Zap, GitBranch, Shield, Folder, Sparkles, Terminal, Network, Link2, Hash, ShieldAlert, Mail } from 'lucide-react';
import type { ToolDef } from './ToolCard';

export interface Category {
  slug: string;
  title: string;
  icon: any;
  banner?: { kind: 'standard' | 'critical'; text: string };
  tools: ToolDef[];
}

const CRITICAL_BANNER = {
  kind: 'critical' as const,
  text: 'AUTHORIZED USE ONLY — CRIMINAL LIABILITY. Unauthorized scanning, exploitation, or credential testing against third-party systems violates 18 U.S.C. § 1030 (CFAA) and Utah Code § 76-6-703. Every tool here is for defensive research, written-scope pentesting, or RMPG-owned assets only.',
};

export const CATEGORY_REGISTRY: Category[] = [
  {
    slug: 'osint',
    title: 'OSINT — Open-Source Intelligence',
    icon: Search,
    tools: [
      { id: 'whois', icon: Globe, title: 'WHOIS Lookup', description: 'Registrar, nameservers, creation/expiry dates for a domain or IP.', args: [{ name: 'target', label: 'Domain or IP', placeholder: 'example.com', required: true }], runLabel: 'whois' },
      { id: 'dig-dns', icon: Network, title: 'DNS Records', description: 'All DNS records (A, AAAA, MX, NS, TXT) for a domain via dig.', args: [{ name: 'target', label: 'Domain', placeholder: 'example.com', required: true }], runLabel: 'dig' },
      { id: 'sherlock', icon: Users, title: 'Sherlock — Username Search', description: 'Search 400+ social platforms for a given username. Returns profiles where the username is taken.', args: [{ name: 'username', label: 'Username', placeholder: 'jdoe', required: true }], runLabel: 'sherlock', installPkg: 'sherlock' },
      { id: 'theharvester', icon: Mail, title: 'theHarvester — Email/Subdomain', description: 'Collect emails, subdomains, hosts, IPs from public sources (crt.sh, DuckDuckGo, Bing).', args: [{ name: 'domain', label: 'Domain', placeholder: 'example.com', required: true }], runLabel: 'theHarvester', installPkg: 'theharvester' },
      { id: 'holehe', icon: Mail, title: 'Holehe — Email → Accounts', description: 'Check if an email is registered on 100+ services (Twitter, Adobe, Amazon, etc.) without alerting the owner.', args: [{ name: 'email', label: 'Email', placeholder: 'user@example.com', required: true }], runLabel: 'holehe', installPkg: 'holehe' },
    ],
  },
  {
    slug: 'web-recon',
    title: 'Web Recon',
    icon: Globe,
    banner: CRITICAL_BANNER,
    tools: [
      { id: 'subfinder', icon: Network, title: 'Subfinder — Subdomain Enum', description: 'Passive subdomain discovery via 50+ public sources (crt.sh, certspotter, hackertarget, etc.).', args: [{ name: 'domain', label: 'Domain', placeholder: 'example.com', required: true }], runLabel: 'subfinder', installPkg: 'subfinder' },
      { id: 'httpx-fingerprint', icon: Zap, title: 'HTTPX Fingerprint', description: 'Probe live web servers for title, tech stack, status, and server headers.', args: [{ name: 'url', label: 'URL', placeholder: 'https://example.com', required: true }], runLabel: 'httpx', installPkg: 'httpx' },
      { id: 'nuclei', icon: Bug, title: 'Nuclei — Template Scanner', description: 'Vulnerability scanning via 6000+ community templates. Only medium+ severities reported.', requiresAuthorization: 'Active scanning — authorized scope only.', args: [{ name: 'url', label: 'URL', placeholder: 'https://example.com', required: true }], runLabel: 'nuclei', installPkg: 'nuclei' },
      { id: 'wafw00f', icon: Shield, title: 'WAFW00F — WAF Detection', description: 'Identify whether a target is protected by a Web Application Firewall and which vendor.', args: [{ name: 'url', label: 'URL', placeholder: 'https://example.com', required: true }], runLabel: 'wafw00f', installPkg: 'wafw00f' },
      { id: 'ffuf', icon: Folder, title: 'ffuf — Web Fuzzer', description: 'Fast web fuzzer. URL must contain FUZZ placeholder. Uses seclists common wordlist.', requiresAuthorization: 'Generates significant traffic — authorized scope only.', args: [{ name: 'url', label: 'URL with FUZZ', placeholder: 'https://example.com/FUZZ', required: true }], runLabel: 'ffuf', installPkg: 'ffuf' },
    ],
  },
  {
    slug: 'network-scanning',
    title: 'Network Scanning',
    icon: Wifi,
    banner: CRITICAL_BANNER,
    tools: [
      { id: 'nmap-quick', icon: Zap, title: 'Nmap Quick Scan', description: 'TCP connect scan of the top 100 ports with -T4 timing.', requiresAuthorization: 'Scans without authorization may violate CFAA.', args: [{ name: 'target', label: 'Target host/IP/CIDR', placeholder: '192.168.1.0/24', required: true }], runLabel: 'nmap', installPkg: 'nmap' },
      { id: 'nmap-full', icon: Terminal, title: 'Nmap Full Scan', description: 'All 65,535 TCP ports + service version detection. Slow but thorough.', requiresAuthorization: 'Scans without authorization may violate CFAA.', args: [{ name: 'target', label: 'Target host/IP', placeholder: '10.0.0.5', required: true }], runLabel: 'nmap', installPkg: 'nmap' },
      { id: 'masscan', icon: Zap, title: 'masscan — High-Speed', description: 'Asynchronous port scanner. 1000 packets/sec by default, ports 1-1000.', requiresAuthorization: 'High packet rate can trigger IDS — authorized scope only.', args: [{ name: 'target', label: 'IP/CIDR', placeholder: '10.0.0.0/24', required: true }, { name: 'ports', label: 'Ports (optional)', placeholder: '80,443 or 1-65535' }], runLabel: 'masscan', installPkg: 'masscan' },
      { id: 'naabu', icon: Network, title: 'naabu — Fast Port Scan', description: 'ProjectDiscovery\'s fast SYN/CONNECT scanner.', args: [{ name: 'target', label: 'Host/IP', placeholder: 'example.com', required: true }], runLabel: 'naabu', installPkg: 'naabu' },
      { id: 'local-network', icon: Network, title: 'Local Network Hosts (ARP)', description: 'Dump the ARP cache — every device your machine has talked to on the subnet.', runLabel: 'arp -an' },
    ],
  },
  {
    slug: 'password-tools',
    title: 'Password Tools',
    icon: Lock,
    banner: CRITICAL_BANNER,
    tools: [
      { id: 'hash-identifier', icon: Hash, title: 'Hash Identifier', description: 'Identify the hash algorithm from the hash string (MD5, SHA1, bcrypt, NTLM, etc.).', args: [{ name: 'hash', label: 'Hash', placeholder: '5f4dcc3b5aa765d61d8327deb882cf99', required: true }], runLabel: 'hashid', installPkg: 'hashid' },
      { id: 'john-show', icon: Lock, title: 'John the Ripper', description: 'Attempt raw-MD5 dictionary attack on a hash. Use on hashes you own or are authorized to test.', requiresAuthorization: 'Credential cracking without authorization may violate CFAA.', args: [{ name: 'hash', label: 'Hash', placeholder: '5f4dcc3b5aa765d61d8327deb882cf99', required: true }], runLabel: 'john', installPkg: 'john' },
      { id: 'crunch', icon: KeyRound, title: 'crunch — Wordlist Gen', description: 'Generate a wordlist of the specified length range and charset. Max length capped at 12.', args: [{ name: 'min', label: 'Min length', placeholder: '4', required: true }, { name: 'max', label: 'Max length', placeholder: '6', required: true }, { name: 'charset', label: 'Charset (optional)', placeholder: 'abc123' }], runLabel: 'crunch', installPkg: 'crunch' },
      { id: 'cewl', icon: Folder, title: 'CeWL — Site-Specific Wordlist', description: 'Crawl a URL and build a wordlist from words found on the site. Useful for targeted attacks.', requiresAuthorization: 'Authorized scope only.', args: [{ name: 'url', label: 'URL', placeholder: 'https://example.com', required: true }], runLabel: 'cewl', installPkg: 'cewl' },
    ],
  },
  {
    slug: 'active-directory',
    title: 'Active Directory',
    icon: Server,
    banner: CRITICAL_BANNER,
    tools: [
      { id: 'ldapsearch', icon: Server, title: 'LDAP Anonymous Bind', description: 'Attempt anonymous bind to a domain controller and enumerate naming contexts. Often reveals domain structure.', requiresAuthorization: 'Authorized pentest scope only.', args: [{ name: 'host', label: 'DC host[:port]', placeholder: 'dc.example.local', required: true }, { name: 'base', label: 'Base DN (optional)', placeholder: 'DC=example,DC=local' }], runLabel: 'ldapsearch' },
      { id: 'smbclient-list', icon: Folder, title: 'SMB Share Enumeration', description: 'List shares exposed by an SMB server. Anonymous authentication.', requiresAuthorization: 'Authorized pentest scope only.', args: [{ name: 'host', label: 'Host/IP', placeholder: '10.0.0.5', required: true }], runLabel: 'smbclient -L', installPkg: 'samba' },
      { id: 'dig-dns', icon: Network, title: 'DNS Records', description: 'Query DNS for SRV records that reveal AD services (_ldap._tcp.dc._msdcs.<domain>).', args: [{ name: 'target', label: 'Domain', placeholder: 'example.local', required: true }], runLabel: 'dig' },
    ],
  },
  {
    slug: 'cloud-security',
    title: 'Cloud Security',
    icon: Cloud,
    tools: [
      { id: 'aws-whoami', icon: Cloud, title: 'AWS Caller Identity', description: 'Print the AWS account, user, and ARN that the current credentials resolve to. Fast "who am I" for cloud work.', runLabel: 'aws sts', installPkg: 'awscli' },
      { id: 'trivy-config', icon: ShieldAlert, title: 'Trivy — Config Misconfig', description: 'Scan local config files (Dockerfile, K8s YAML, Terraform) for misconfigurations and security issues.', args: [{ name: 'target', label: 'Local path', placeholder: '/path/to/config', required: true }], runLabel: 'trivy', installPkg: 'trivy' },
    ],
  },
  {
    slug: 'mobile-security',
    title: 'Mobile Security',
    icon: Smartphone,
    tools: [
      { id: 'apktool-info', icon: Smartphone, title: 'APKTool — Decode APK', description: 'Extract Android app resources, decode AndroidManifest.xml, disassemble smali code.', args: [{ name: 'apkPath', label: 'Path to .apk', placeholder: '/path/to/app.apk', required: true }], runLabel: 'apktool d', installPkg: 'apktool' },
      { id: 'strings-apk', icon: FileSearch, title: 'Strings — Binary/APK', description: 'Extract printable ASCII strings from any binary file. Useful for API keys, URLs, hardcoded secrets.', args: [{ name: 'path', label: 'File path', placeholder: '/path/to/file', required: true }], runLabel: 'strings' },
    ],
  },
  {
    slug: 'forensics',
    title: 'Forensics',
    icon: FileSearch,
    tools: [
      { id: 'exiftool', icon: FileSearch, title: 'ExifTool — Metadata Extract', description: 'Extract every metadata field from an image, document, or media file. GPS, camera, author, edit history.', args: [{ name: 'path', label: 'File path', placeholder: '/path/to/file.jpg', required: true }], runLabel: 'exiftool', installPkg: 'exiftool' },
      { id: 'binwalk', icon: Database, title: 'Binwalk — Firmware/Binary', description: 'Analyze a binary for embedded files, firmware structures, compressed data.', args: [{ name: 'path', label: 'Binary path', placeholder: '/path/to/firmware.bin', required: true }], runLabel: 'binwalk', installPkg: 'binwalk' },
      { id: 'file-identify', icon: FileSearch, title: 'File Type Identification', description: 'Identify the actual format of a file regardless of its extension. Useful for suspicious files.', args: [{ name: 'path', label: 'File path', placeholder: '/path/to/file', required: true }], runLabel: 'file' },
      { id: 'hexdump', icon: Hash, title: 'Hexdump (first 512 bytes)', description: 'Show the raw hex + ASCII of the first 512 bytes. Reveals file signatures and obfuscation.', args: [{ name: 'path', label: 'File path', placeholder: '/path/to/file', required: true }], runLabel: 'hexdump' },
    ],
  },
  {
    slug: 'anonymity',
    title: 'Anonymity',
    icon: Radio,
    tools: [
      { id: 'public-ip', icon: Globe, title: 'Current Public IP', description: 'Show your current public IP as seen by the internet. Baseline before enabling a VPN or Tor.', runLabel: 'curl ipify' },
      { id: 'tor-check', icon: Radio, title: 'Tor Status Check', description: 'Attempts to route through a local Tor SOCKS proxy (127.0.0.1:9050) and reports the exit IP. Requires Tor daemon running.', runLabel: 'curl via Tor' },
    ],
  },
  {
    slug: 'reverse-engineering',
    title: 'Reverse Engineering',
    icon: KeyRound,
    tools: [
      { id: 'objdump-disasm', icon: Terminal, title: 'objdump — Disassembly', description: 'Disassemble an executable to show its assembly instructions.', args: [{ name: 'path', label: 'Binary path', placeholder: '/path/to/binary', required: true }], runLabel: 'objdump -d' },
      { id: 'r2-info', icon: Database, title: 'radare2 — Binary Info', description: 'radare2 summary: architecture, entrypoint, sections, imports, symbols.', args: [{ name: 'path', label: 'Binary path', placeholder: '/path/to/binary', required: true }], runLabel: 'r2', installPkg: 'radare2' },
      { id: 'strings-apk', icon: FileSearch, title: 'Strings (Binary)', description: 'Extract printable ASCII strings from any binary. Starting point for most RE workflows.', args: [{ name: 'path', label: 'Binary path', placeholder: '/path/to/binary', required: true }], runLabel: 'strings' },
      { id: 'hexdump', icon: Hash, title: 'Hexdump', description: 'Raw hex + ASCII of the first 512 bytes. Identifies packer signatures.', args: [{ name: 'path', label: 'Binary path', placeholder: '/path/to/binary', required: true }], runLabel: 'hexdump' },
    ],
  },
  {
    slug: 'sql-injection',
    title: 'SQL Injection',
    icon: Database,
    banner: CRITICAL_BANNER,
    tools: [
      { id: 'sqlmap', icon: Database, title: 'SQLMap (Level 1 / Risk 1)', description: 'Non-intrusive SQL injection probing. Tests GET/POST params for common injection patterns.', requiresAuthorization: 'SQL injection testing without written authorization violates CFAA.', args: [{ name: 'url', label: 'URL with param', placeholder: 'https://example.com/page?id=1', required: true }], runLabel: 'sqlmap', installPkg: 'sqlmap' },
    ],
  },
  {
    slug: 'social-engineering',
    title: 'Social Engineering (Defensive)',
    icon: Users,
    tools: [
      { id: 'mx-records', icon: Mail, title: 'MX Records', description: 'Identify a domain\'s mail exchangers — starting point for phishing-defense analysis.', args: [{ name: 'domain', label: 'Domain', placeholder: 'example.com', required: true }], runLabel: 'dig MX' },
      { id: 'spf-records', icon: Shield, title: 'SPF / DMARC Check', description: 'Query TXT records for SPF, DKIM, DMARC policies. Identifies domains vulnerable to spoofing.', args: [{ name: 'domain', label: 'Domain', placeholder: 'example.com', required: true }], runLabel: 'dig TXT' },
      { id: 'whois', icon: Globe, title: 'Domain WHOIS', description: 'Registrar + creation date. Recently-registered lookalike domains are a phishing red flag.', args: [{ name: 'target', label: 'Domain', placeholder: 'example.com', required: true }], runLabel: 'whois' },
    ],
  },
  {
    slug: 'ddos',
    title: 'DDoS / Stress Testing',
    icon: Zap,
    banner: {
      kind: 'critical',
      text: 'DDoS TOOLING INTENTIONALLY LIMITED — This category ships only defensive tools (measuring your own infrastructure\'s resilience). Launching a DoS against a third party is a federal crime (18 U.S.C. § 1030(a)(5)) carrying up to 10 years imprisonment. RMPG does not provide offensive DoS capabilities through this app.',
    },
    tools: [
      { id: 'httpx-fingerprint', icon: Shield, title: 'HTTPX Uptime Probe', description: 'Non-abusive single-request check that a given URL is alive. For monitoring your own services, not for attack.', args: [{ name: 'url', label: 'URL', placeholder: 'https://example.com', required: true }], runLabel: 'httpx', installPkg: 'httpx' },
    ],
  },
  {
    slug: 'post-exploitation',
    title: 'Post-Exploitation (Defensive)',
    icon: GitBranch,
    banner: {
      kind: 'critical',
      text: 'POST-EXPLOITATION TOOLING INTENTIONALLY LIMITED — Active post-exploitation (lateral movement, credential harvesting, persistence) is out of scope for this app. This category ships only local-machine defensive audits that help you identify what an attacker would find on a host you already control.',
    },
    tools: [
      { id: 'public-ip', icon: Eye, title: 'Local Public IP', description: 'What public IP does this host present? First thing an attacker would log after landing.', runLabel: 'curl ipify' },
      { id: 'file-identify', icon: FileSearch, title: 'Suspicious File Identify', description: 'Identify an unknown binary found on a compromised host.', args: [{ name: 'path', label: 'Path', placeholder: '/tmp/unknown.bin', required: true }], runLabel: 'file' },
      { id: 'strings-apk', icon: FileSearch, title: 'Strings on Unknown Binary', description: 'Quick pass for hardcoded IPs, URLs, or commands in a suspicious binary.', args: [{ name: 'path', label: 'Path', placeholder: '/tmp/unknown.bin', required: true }], runLabel: 'strings' },
    ],
  },
];

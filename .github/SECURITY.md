# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 5.7.x   | :white_check_mark: |
| < 5.7   | :x:                |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues via GitHub's private vulnerability reporting:

1. Go to the **Security** tab of this repository
2. Click **Report a vulnerability**
3. Fill in the details

Or email: security@rmpgutah.us

### What to include

- Description of the vulnerability
- Steps to reproduce
- Affected components (client, server, desktop, API endpoint)
- Severity assessment (if known)

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity (critical: 24-72h, high: 1 week, medium: 2 weeks)

## Security Measures

- All routes require JWT authentication via `authenticateToken` middleware
- TOTP 2FA with AES-256-GCM encrypted secrets
- WebAuthn (FIDO2/YubiKey) support
- Role-based access control (8 roles)
- Rate limiting on auth endpoints
- Audit logging for all data modifications
- CodeQL SAST scanning on every push
- Dependabot automated dependency monitoring
- Secret scanning with push protection enabled

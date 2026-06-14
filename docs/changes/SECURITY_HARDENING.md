# Security Hardening Pass - json-server

## Overview
This document outlines the security improvements implemented in this hardening pass for json-server.

## Implemented Security Controls

### 1. CLI Argument Validation (bin.ts)
- **Issue**: CLI arguments were accepted without validation, risking path traversal and command injection
- **Solution**: Implement strict path validation with:
  - Absolute path resolution
  - Path traversal detection (prevents `../` escapes)
  - File existence verification
  - Containment within project directory

### 2. Where-Operators Type Bounds (where-operators.ts)
- **Issue**: Comparison operators accepted arbitrary types, risking type confusion attacks
- **Solution**: Add strict type validation:
  - Comparable type checking (string, number, boolean, null only)
  - Type consistency enforcement (both operands must match types)
  - Input bounds validation (strings limited to 10KB)

### 3. Matches-Where Operator Allowlist (matches-where.ts)
- **Issue**: Unsafe operator evaluation without explicit whitelist
- **Solution**: Enforce strict operator validation:
  - Explicit whitelist check before evaluation
  - Function type verification
  - Error handling for operator evaluation failures
  - Logging of unauthorized operators

### 4. Security Headers (app.ts)
- **Issue**: Application lacked CSP and other security headers
- **Solution**: Implement comprehensive security headers:
  - Content-Security-Policy: Prevents inline scripts and restricts resources
  - X-Frame-Options: DENY (prevents clickjacking)
  - X-Content-Type-Options: nosniff (prevents MIME sniffing)
  - X-XSS-Protection: 1; mode=block (legacy XSS protection)
  - Referrer-Policy: strict-origin-when-cross-origin

### 5. Request Size Limits (app.ts)
- **Issue**: No global body size limit could enable memory exhaustion DoS
- **Solution**: Implement size enforcement:
  - Global body size limit: 1MB
  - Content-Length pre-check
  - 413 Payload Too Large responses

### 6. Audit Logging (service.ts)
- **Issue**: Database modifications had no audit trail
- **Solution**: Add operation logging:
  - Log all CREATE, UPDATE, PATCH, DELETE operations
  - Include timestamp, resource, and operation details
  - Limited detail logging (500 char max) to prevent log spam

### 7. Enhanced Input Sanitization (service.ts)
- **Issue**: Nested object properties not thoroughly validated
- **Solution**: Strengthen sanitizeItem function:
  - Property count limits (max 100)
  - Property name length limits (max 255 chars)
  - Property value size limits (max 100KB)
  - Prototype pollution prevention
  - Forbidden key rejection
  - Non-serializable type rejection

### 8. Normalized Adapter Schema Validation (normalized-adapter.ts)
- **Issue**: Adapter layer lacked structure validation
- **Solution**: Add validateDataStructure function:
  - Ensures data is object (not array)
  - Validates all keys are strings
  - Validates all values are arrays or objects
  - Rejects malformed data structures

### 9. Observer Adapter Content Validation (observer.ts)
- **Issue**: Write operations could silently corrupt data
- **Solution**: Add write-time validation:
  - Rejects null/undefined writes
  - Warns on empty object writes
  - Captures and logs write errors

## Environment Configuration

For enhanced security, configure the following environment variables:

```bash
# Enable authentication (default: false)
AUTH_ENABLED=true

# Comma-separated list of valid API keys
API_KEYS=key1,key2,key3

# Comma-separated list of allowed CORS origins
CORS_ORIGIN_ALLOWLIST=http://localhost:3000,https://example.com
```

## Known Limitations & Further Recommendations

### Not Yet Implemented
1. **Role-Based Access Control**: Current auth is simple API key validation
2. **Rate Limiting**: No request rate limiting implemented
3. **Soft Delete**: Delete operations are permanent
4. **Data Encryption**: Data at rest is not encrypted
5. **HTTPS Enforcement**: Should enforce HTTPS in production

### Recommended Next Steps
1. Implement rate limiting middleware
2. Add optional JWT token support
3. Implement soft-delete with tombstone records
4. Add data encryption at rest
5. Implement request signing for sensitive operations
6. Add IP whitelisting capabilities
7. Consider implementing change audit versioning

## Testing

Run the security test suite to validate controls:

```bash
pnpm run test
```

The test suite includes:
- Input validation tests
- Where clause security tests
- Payload security tests
- Path traversal protection tests
- CORS validation tests
- Request size limit tests
- Adapter validation tests

## Deployment Best Practices

1. **Always enable AUTH_ENABLED in production**
2. **Set strong, random API_KEYS**
3. **Configure CORS_ORIGIN_ALLOWLIST for your domain only**
4. **Use HTTPS in production**
5. **Monitor audit logs regularly** (look for `[audit]` prefix in logs)
6. **Keep dependencies updated**
7. **Review and rotate API keys regularly**
8. **Use strong authentication for administrative access**

## Audit Log Format

All database modifications are logged with this format:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "operation": "CREATE|UPDATE|PATCH|DELETE",
  "resource": "posts",
  "id": "uuid-or-id",
  "details": "JSON string (max 500 chars)"
}
```

Example log entries:
```
[audit] {"timestamp":"2024-01-15T10:30:45.123Z","operation":"CREATE","resource":"posts","id":"abc123","details":"..."}
[audit] {"timestamp":"2024-01-15T10:31:12.456Z","operation":"DELETE","resource":"posts","id":"abc123"}
```

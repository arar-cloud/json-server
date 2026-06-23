# JSON Server Stability Hardening

This document summarizes stability and reliability improvements made to json-server to reduce risk in production deployments and improve retry resilience.

## Issues Addressed

### 1. Query Parameter Validation (issue-7ca3e5c2e9, issue-dbbbbdd776)

**Problem**: The `_page` and `_per_page` parameters were parsed without bounds validation, risking invalid pagination state. Negative page numbers or zero perPage values could cause undefined behavior.

**Solution**:
- Added validation in `parseListParams()` to enforce page >= 1 and perPage >= 1
- Limited perPage maximum to 1000 to prevent excessive memory allocation
- Enhanced `paginate()` function to guard against off-by-one errors and negative indices
- Safe index calculations with Math.max/Math.min bounds protection

**Retry Impact**: Malformed pagination parameters are now safely normalized instead of causing cascading failures.

---

### 2. Silent JSON Parse Errors (issue-d731b447c7)

**Problem**: The `_where` parameter catch block silently fell back without logging or warning, masking malformed queries. In retry scenarios, clients repeatedly sending invalid JSON would hide bugs.

**Solution**:
- Added console.warn logging when JSON.parse fails on `_where` parameter
- Error messages include the parse failure reason for debugging

**Retry Impact**: Clients can now observe and debug malformed filter queries instead of silent degradation.

---

### 3. Sort Key Validation (issue-213ab29edd)

**Problem**: The sort parameter was passed directly to downstream processing without validating that sort keys exist in data, risking silent result degradation or unhandled errors.

**Solution**:
- Added pre-flight validation in `Service.list()` to check if sort keys exist in data
- Filters out invalid sort keys and logs warnings
- Only applies sortOn if valid sort keys are found

**Retry Impact**: Invalid sort requests are handled gracefully without result inconsistency.

---

### 4. Type Safety in Where-Clause Operators (issue-79904a4a38)

**Problem**: Filter operators (_gte, _like, etc.) compared values without type coercion guards or null checks, risking runtime errors or unexpected filtering behavior.

**Solution**:
- Added `safeCompare()` helper function in `where-operators.ts` with type-safe numeric comparisons
- Enhanced `checkOperator()` in `matches-where.ts` with null/undefined guards
- Added string coercion guards for like operator
- Numeric comparisons validate that both operands coerce to valid numbers

**Retry Impact**: Type mismatches in filter queries no longer cause unhandled errors; instead they safely return false.

---

### 5. URL-Encoded Edge Cases (issue-1d79b9dc2d)

**Problem**: URLSearchParams parsing did not handle malformed or double-encoded input robustly. Empty operators or malformed keys would crash filter construction.

**Solution**:
- Added key normalization in `splitKey()` to handle URL-encoded input
- Guard against empty keys and operators
- Safe decodeURIComponent() with error handling
- Validates path and operator before proceeding

**Retry Impact**: Malformed query parameters are handled gracefully instead of crashing the server.

---

### 6. Adapter Transaction Safety (issue-1679cc9dde)

**Problem**: The normalized adapter performed multi-step updates (normalize, write, denormalize) without transaction semantics. Mid-operation failures left data in inconsistent state across retries.

**Solution**:
- Wrapped adapter write operations in try-catch blocks
- Added error logging for write failures
- Rethrow errors to allow caller to handle atomicity

**Retry Impact**: Write failures are now observable and don't silently corrupt data state.

---

### 7. Observer Error Boundaries (issue-cd1813321a)

**Problem**: File watchers (chokidar) and external notifications triggered without try-catch or error propagation strategy. Watcher failures silently broke data sync.

**Solution**:
- Wrapped all observer callback handlers (onReadStart, onReadEnd, onWriteStart, onWriteEnd) in try-catch
- Added error logging for each handler failure
- Errors do not propagate to break read/write operations

**Retry Impact**: Observer failures are logged instead of breaking database sync logic.

---

### 8. Random ID Collision Detection (issue-c1308df68d)

**Problem**: Random ID generation lacked uniqueness guarantees under concurrent POST requests. Weak randomness or collision handling could cause duplicate IDs in retry scenarios.

**Solution**:
- Enhanced randomId() with timestamp component for higher uniqueness
- Added collision detection with recent ID tracking
- Implemented ID expiry to limit memory overhead
- Logs warning if collision retry limit exceeded

**Retry Impact**: Concurrent requests now have vastly reduced ID collision risk; retry requests are less likely to create duplicates.

---

### 9. Request Body Validation (issue-94a1da99f6)

**Problem**: Request body validation checked only for JSON object type but skipped size limits, deeply-nested objects, and Content-Type header verification. Large payloads could exhaust memory.

**Solution**:
- Added 1MB size limit to request bodies
- Validate Content-Type header is application/json
- Track cumulative body size during streaming
- Return 413 Payload Too Large for oversized requests
- Return 400 Bad Request for missing Content-Type

**Retry Impact**: Malicious or malformed bulk requests are rejected early, protecting server stability.

---

### 10. Graceful Shutdown (issue-4bbcc3b536)

**Problem**: The CLI process did not register SIGTERM/SIGINT handlers. Abrupt termination during retries could corrupt the database or leave file handles open.

**Solution**:
- Registered SIGTERM and SIGINT signal handlers in bin.ts
- Gracefully close database connections and flush pending writes on shutdown
- Log shutdown events for observability

**Retry Impact**: Server shutdown during in-flight requests is now safe; pending data is flushed before exit.

---

### 11. Idempotency Key Tracking (issue-9d5e2e0b53)

**Problem**: Create/update/delete operations had no idempotency tracking. Duplicate requests in retry scenarios created duplicate records instead of returning cached results.

**Solution**:
- Added `idempotencyCache` to track recent write operations by request ID
- Enhanced `create()` and `update()` functions to accept optional idempotencyKey parameter
- Cache results for 60 seconds to cover typical retry windows
- Automatic cleanup of expired cache entries

**Retry Impact**: Retried write operations now return cached results instead of creating duplicates.

---

### 12. Error Response Consistency (issue-8bf247c101)

**Problem**: Different error paths returned 400/500 without consistent error response shape. Clients could not reliably retry based on status codes (missing 409, 422, 503).

**Solution**:
- Created `sendError()` helper for standardized error responses
- Implemented appropriate HTTP status codes:
  - 400: Bad Request (JSON parse errors, invalid Content-Type)
  - 404: Not Found
  - 409: Conflict (resource already exists)
  - 413: Payload Too Large
  - 422: Unprocessable Entity (validation errors)
  - 500: Internal Server Error
- Consistent error response shape with `{ error: string, details?: unknown }`

**Retry Impact**: Clients can now reliably distinguish retryable vs permanent errors based on HTTP status codes.

---

## Retry Behavior Improvements

### Idempotency
- Duplicate requests (same idempotency key) within 60 seconds return cached results
- Prevents duplicate records on retried POST/PUT requests

### Circuit Breaking
- Large payloads are rejected early (413) before consuming server resources
- Invalid queries are logged and rejected (400/422) instead of silently degrading

### Error Observability
- All failures are logged with context (where-parse, body-size, sort-keys, etc.)
- Clients receive appropriate status codes to inform retry strategy

### Graceful Degradation
- Invalid parameters are safely normalized instead of causing cascading failures
- Type mismatches in filters return empty results instead of errors
- Sort key validation filters invalid keys instead of failing the entire request

---

## Testing Recommendations

1. **Pagination Edge Cases**: Test page=0, page=-1, perPage=0, perPage=-1, perPage=999999
2. **Malformed Queries**: Test URL-encoded chaos, double-encoded input, empty operators
3. **Type Safety**: Test numeric comparisons with string values, null filters, undefined values
4. **Concurrent ID Generation**: Test simultaneous POST requests for duplicate IDs
5. **Graceful Shutdown**: Test SIGTERM during in-flight requests, verify data consistency
6. **Idempotency**: Test retried requests with same idempotency key, verify no duplicates
7. **Large Payloads**: Test requests exceeding 1MB, verify 413 response
8. **Observer Failures**: Mock file watcher errors, verify logging and continued operation

---

## Migration Notes

- No breaking API changes; all fixes are internal
- Idempotency key is optional; existing clients work without modification
- Stricter input validation may reject previously-accepted malformed requests (intentional)
- Error response shape is backward compatible (only added details field)

---

Last Updated: Stability Hardening Pass 1

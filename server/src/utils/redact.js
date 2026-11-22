/** Keep operational logs useful without ever echoing an authorization or API key value. */
export function redactSecrets(value) {
  return String(value || '')
    .replace(/(Bearer\s+)[^\s,]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,&]+/gi, '$1[REDACTED]');
}

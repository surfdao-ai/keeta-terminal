'use client';

/**
 * The browser's API helper.
 *
 * Every mutating request carries the CSRF token that was issued with the
 * session (it lives in a readable cookie, so the browser can echo it). No
 * key material is ever attached here — the seed stays in the vault.
 */

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)kt_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function apiFetch(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-kt-csrf', csrfToken());
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    init = { ...init, body: JSON.stringify(init.json) };
  }
  return fetch(path, { ...init, headers, credentials: 'same-origin' });
}

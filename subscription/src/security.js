const encoder = new TextEncoder();
export const iso = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
export async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:encoder.encode(salt), iterations:100000}, key, 256);
  return Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('');
}
export function fail(message, status = 400) { return Object.assign(new Error(message), {status}); }
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw fail('รหัสผ่านต้องมี 12–128 ตัวอักษร');
}
export function effectiveStatus(tenant, now = new Date()) {
  if (tenant.status === 'suspended') return 'suspended';
  return new Date(tenant.expires_at) <= now ? 'expired' : tenant.status;
}
export function addMonths(isoDate, months) {
  const date = new Date(isoDate), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}
export function publicTenant(tenant) {
  const {service_token_hash, ...safe} = tenant;
  return {...safe, effective_status:effectiveStatus(tenant)};
}

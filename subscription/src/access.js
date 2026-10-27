import {createRemoteJWKSet,decodeJwt,jwtVerify} from 'jose';
import {fail} from './security.js';

// Cloudflare Access (One-time PIN) identity, shared by the stock and subscription Workers.
// Every request carries Cf-Access-Jwt-Assertion; the Worker verifies it even though Access sits in front.
const LOCAL_HOSTS = new Set(['localhost','127.0.0.1','[::1]']);
const jwksCache = new Map();

function remoteJwks(teamDomain) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`)); jwksCache.set(teamDomain, jwks); }
  return jwks;
}

/** Returns the verified, lowercased email of the caller or throws 401/500. */
export async function accessEmail(request, env) {
  if (env.DEV_ACCESS_EMAIL && LOCAL_HOSTS.has(new URL(request.url).hostname)) {
    return String(request.headers.get('x-dev-user-email') || env.DEV_ACCESS_EMAIL).trim().toLowerCase();
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw fail('กรุณาเข้าสู่ระบบผ่าน Cloudflare Access', 401);
  // Trim: a pasted secret can carry a trailing newline, which would make every audience check fail.
  const aud = String(env.ACCESS_AUD || '').trim(), team = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/\/+$/, '');
  if (!aud || !team) {
    console.error('Access is not configured (ACCESS_AUD / ACCESS_TEAM_DOMAIN)');
    throw fail('ยังไม่ได้ตั้งค่า Cloudflare Access', 500);
  }
  let payload;
  try { ({payload} = await jwtVerify(token, remoteJwks(team), {issuer:team, audience:aud})); }
  catch (error) {
    // Log why (no email): wrong AUD/issuer, bad signature, expiry or a JWKS fetch failure all look the same to the user.
    let claims = {};
    try { const c = decodeJwt(token); claims = {iss:c.iss, aud:c.aud, exp:c.exp}; } catch {}
    console.error('Access JWT rejected', {code:error?.code, message:error?.message, expectedAud:aud.slice(0,8), expectedIss:team, ...claims});
    throw fail('Access token ไม่ถูกต้องหรือหมดอายุ', 401);
  }
  if (typeof payload.email !== 'string' || !payload.email) throw fail('Access token ไม่มีอีเมล', 401);
  return payload.email.trim().toLowerCase();
}

export const ACCESS_LOGOUT = '/cdn-cgi/access/logout';

/**
 * Invite password gate for sign-up.
 *
 * - Reads `LOOP_INVITE_PASSWORD` or comma-separated `LOOP_INVITE_PASSWORDS`.
 * - When neither is set, sign-up is open. This is for local development only.
 * - Compares in constant time so the response shape never reveals which slot matched.
 */
export type InviteEnv = {
  LOOP_INVITE_PASSWORD?: string;
  LOOP_INVITE_PASSWORDS?: string;
};

export function allowedInvites(env: InviteEnv | undefined): string[] {
  const single = env?.LOOP_INVITE_PASSWORD?.trim();
  const many = (env?.LOOP_INVITE_PASSWORDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...(single ? [single] : []), ...many];
}

export function inviteRequired(env: InviteEnv | undefined): boolean {
  return allowedInvites(env).length > 0;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export function verifyInvite(env: InviteEnv | undefined, supplied: string | null | undefined): boolean {
  const allowed = allowedInvites(env);
  if (allowed.length === 0) return true;
  if (!supplied) return false;
  const candidate = String(supplied);
  return allowed.some((expected) => constantTimeEquals(expected, candidate));
}

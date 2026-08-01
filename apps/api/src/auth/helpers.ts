import type { AuthUser } from './types';
import { users } from '../db/schema';

export function publicUser(user: typeof users.$inferSelect): AuthUser {
  return { id: user.id, email: user.email, displayName: user.displayName, instanceRole: user.instanceRole, theme: user.theme as AuthUser['theme'] };
}



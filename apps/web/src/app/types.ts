import type { User } from '../api';

export type Session = { user: User; csrfToken: string };

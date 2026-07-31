import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

export const api = createClient<paths>({ baseUrl: '/api/v1', credentials: 'include' });
export type { components, paths } from './schema.js';

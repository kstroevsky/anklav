import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
});

export const setupSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(100),
  workspaceName: z.string().trim().min(1).max(120),
  setupToken: z.string().min(16).max(512),
});



import { z } from 'zod';

export const userIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid user ID format');
export const roleSchema = z.enum(['user', 'admin']);

import { z } from 'zod';

export const userIdSchema = z.string().min(1).max(128);
export const sessionContentSchema = z.string().min(1).max(50000);
export const roleSchema = z.enum(['user', 'admin']);

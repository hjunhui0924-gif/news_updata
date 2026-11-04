import { z } from 'zod';
export const feedQuerySchema = z.object({
  view: z.enum(['feed', 'saved']).default('feed'),
  type: z.enum(['all', 'release', 'new_repo', 'video']).default('all'),
  search: z.string().max(200).default(''),
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  source: z.string().max(100).default(''),
  cursor: z.string().max(300).optional(),
});

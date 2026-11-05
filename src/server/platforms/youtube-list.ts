import { z } from 'zod';

// Omitted items is an empty list only when the response explicitly reports zero results.
// Do not silently turn malformed payloads or inconsistent pagination into success.
export function youtubeListSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      items: z.array(itemSchema).max(50).optional(),
      pageInfo: z.object({ totalResults: z.number().int().nonnegative() }).optional(),
      nextPageToken: z.string().min(1).max(2000).optional(),
    })
    .refine(
      (data) =>
        data.items !== undefined || (data.pageInfo?.totalResults === 0 && !data.nextPageToken),
    )
    .transform((data) => ({ ...data, items: data.items ?? [] }));
}

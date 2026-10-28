import type { H3Event } from 'h3';
import type { ZodType } from 'zod';

export async function validateBody<T>(
  event: H3Event,
  schema: ZodType<T>,
): Promise<T> {
  const result = await readValidatedBody(event, (b) => schema.safeParse(b));
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: result.error.issues,
    });
  }
  return result.data;
}

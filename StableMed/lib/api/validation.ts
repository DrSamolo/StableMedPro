import type { z, ZodSchema } from "zod";

import { ApiError } from "./errors";

export function validateWithSchema<TSchema extends ZodSchema>(
  schema: TSchema,
  payload: unknown,
): z.infer<TSchema> {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Payload invalide", parsed.error.flatten());
  }

  return parsed.data;
}

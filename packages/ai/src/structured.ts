import { z, type ZodType } from 'zod';
import { LocalAIError } from './types';

export function stripMarkdownJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function parseStructuredValue<T>(
  raw: string,
  schema: ZodType<T>,
): { value: T; strippedFence: boolean } {
  const stripped = stripMarkdownJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    throw new LocalAIError(
      'MALFORMED_RESPONSE',
      `The model returned invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
      undefined,
      true,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new LocalAIError(
      'SCHEMA_VALIDATION_FAILED',
      `The JSON did not match the game contract: ${issues}`,
      undefined,
      true,
    );
  }
  return { value: result.data, strippedFence: stripped !== raw.trim() };
}

export function jsonSchemaFor<T>(schema: ZodType<T>): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'draft-07',
    unrepresentable: 'throw',
  });
}

export function contentFromOpenAIResponse(payload: unknown): string {
  const parsed = z
    .object({
      choices: z
        .array(
          z.object({
            message: z.object({
              content: z.union([
                z.string(),
                z.array(
                  z.object({
                    type: z.string().optional(),
                    text: z.string().optional(),
                  }),
                ),
              ]),
            }),
          }),
        )
        .min(1),
    })
    .safeParse(payload);
  if (!parsed.success) {
    throw new LocalAIError(
      'MALFORMED_RESPONSE',
      'The server response did not contain choices[0].message.content.',
    );
  }
  const content = parsed.data.choices[0]?.message.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((part) => part.type !== 'reasoning')
    .map((part) => part.text ?? '')
    .join('');
}

export function usageFromOpenAIResponse(payload: unknown): {
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSecond?: number;
} {
  const parsed = z
    .object({
      usage: z
        .object({
          prompt_tokens: z.number().optional(),
          completion_tokens: z.number().optional(),
          tokens_per_second: z.number().optional(),
        })
        .optional(),
    })
    .safeParse(payload);
  if (!parsed.success || !parsed.data.usage) return {};
  return {
    ...(parsed.data.usage.prompt_tokens !== undefined
      ? { promptTokens: parsed.data.usage.prompt_tokens }
      : {}),
    ...(parsed.data.usage.completion_tokens !== undefined
      ? { completionTokens: parsed.data.usage.completion_tokens }
      : {}),
    ...(parsed.data.usage.tokens_per_second !== undefined
      ? { tokensPerSecond: parsed.data.usage.tokens_per_second }
      : {}),
  };
}

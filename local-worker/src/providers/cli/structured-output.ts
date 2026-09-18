import { z } from "zod";

/**
 * The two ends of structured CLI output: the JSON Schema handed to the CLI, and the one bounded
 * repair applied to what comes back. The Zod artifact contract remains the authority on both.
 */

type JsonSchemaNode = { [key: string]: unknown };

/**
 * Keywords kept in the schema a CLI receives.
 *
 * Codex forwards `--output-schema` to OpenAI's strict structured outputs, which reject a schema
 * that uses keywords outside a small supported set, and Zod emits some that no provider knows
 * (`format: "starts_with"`). The worker therefore sends only the structural core — types,
 * properties, enums, nullability — and every length, range, pattern, and cross-field rule is
 * enforced afterwards by the same Zod schema that validates mock, manual, and API output. Strict
 * mode also requires every property to be listed as required, so a field Zod treats as optional
 * (because it has a default) is required here; the prompts already ask for every field.
 */
const KEPT_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "items",
  "additionalProperties",
  "anyOf",
  "enum",
  "description",
]);

export function providerJsonSchema(schema: z.ZodType): JsonSchemaNode {
  const generated = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return project(generated as JsonSchemaNode);
}

function project(node: JsonSchemaNode): JsonSchemaNode {
  const result: JsonSchemaNode = {};
  for (const [keyword, value] of Object.entries(node)) {
    if (!KEPT_KEYWORDS.has(keyword)) continue;
    if (keyword === "properties" && isNode(value)) {
      result.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          isNode(child) ? project(child) : child,
        ]),
      );
    } else if (keyword === "items" && isNode(value)) {
      result.items = project(value);
    } else if (keyword === "anyOf" && Array.isArray(value)) {
      result.anyOf = value.map((child) => (isNode(child) ? project(child) : child));
    } else {
      result[keyword] = value;
    }
  }
  if (result.type === "object" && isNode(result.properties)) {
    result.required = Object.keys(result.properties);
    result.additionalProperties = false;
  }
  return result;
}

function isNode(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a CLI's final message as a JSON object. The single repair (plan section 9: "one bounded
 * local repair/parse attempt") is to take the outermost `{…}` when the model wrapped the object in
 * a Markdown fence or a sentence. Nothing is rewritten, re-ordered, or defaulted; a value that
 * still does not parse is reported as invalid output.
 */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct.ok) return direct.value;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const extracted = tryParse(trimmed.slice(start, end + 1));
    if (extracted.ok) return extracted.value;
  }
  throw new SyntaxError("the response is not a JSON object");
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return isNode(value) ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** A short, single-line view of an unusable response, for the run's error summary. */
export function excerpt(text: string, maximum = 300): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened.length <= maximum ? flattened : `${flattened.slice(0, maximum - 1)}…`;
}

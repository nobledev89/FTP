import { describe, expect, it } from "vitest";

import {
  auditOutputSchema,
  draftOutputSchema,
  researchPacketOutputSchema,
} from "../../contracts/artifacts.js";
import { excerpt, parseJsonObject, providerJsonSchema } from "./structured-output.js";

type Node = { [key: string]: unknown };

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) node.forEach((child) => walk(child, visit));
  else if (node && typeof node === "object") {
    visit(node as Node);
    Object.values(node).forEach((child) => walk(child, visit));
  }
}

describe("providerJsonSchema", () => {
  const schemas = {
    research: researchPacketOutputSchema,
    draft: draftOutputSchema,
    audit: auditOutputSchema,
  };

  it.each(Object.entries(schemas))(
    "makes the %s schema strict-mode compatible: every property required, no extras",
    (_name, schema) => {
      const projected = providerJsonSchema(schema);
      expect(projected.type).toBe("object");
      walk(projected, (node) => {
        if (node.type === "object" && node.properties) {
          expect(node.required).toEqual(Object.keys(node.properties as Node));
          expect(node.additionalProperties).toBe(false);
        }
      });
    },
  );

  it("drops keywords strict structured outputs reject, including Zod-only formats", () => {
    const text = JSON.stringify(
      [researchPacketOutputSchema, draftOutputSchema, auditOutputSchema].map(providerJsonSchema),
    );
    for (const keyword of ["$schema", "format", "pattern", "minLength", "maxLength", "default"]) {
      expect(text).not.toContain(`"${keyword}"`);
    }
    expect(text).not.toContain("starts_with");
  });

  it("keeps enums and nullability so the model sees the real choices", () => {
    const draft = providerJsonSchema(draftOutputSchema) as {
      properties: Record<string, Node>;
    };
    expect(draft.properties.metaTitle).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    const brief = (draft.properties.imageBriefs as { items: { properties: Record<string, Node> } })
      .items;
    expect(brief.properties.aspectRatio).toEqual({
      type: "string",
      enum: ["16:9", "4:5", "3:2", "1:1"],
    });
  });
});

describe("parseJsonObject", () => {
  it("parses a bare object and repairs only a fence or surrounding prose", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Here is the packet:\n{"a":{"b":[1,2]}}\nDone.')).toEqual({
      a: { b: [1, 2] },
    });
  });

  it("rejects anything that is not one JSON object", () => {
    expect(() => parseJsonObject("[1,2]")).toThrow(SyntaxError);
    expect(() => parseJsonObject("no json here")).toThrow(SyntaxError);
    expect(() => parseJsonObject('{"a":1')).toThrow(SyntaxError);
  });
});

describe("excerpt", () => {
  it("flattens and bounds text for an error summary", () => {
    expect(excerpt("a\n\n b   c")).toBe("a b c");
    expect(excerpt("x".repeat(500), 10)).toHaveLength(10);
  });
});

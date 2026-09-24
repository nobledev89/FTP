import { describe, expect, it } from "vitest";

import {
  getTopic,
  normaliseCategory,
  storedCategoryVariants,
  topicForCategory,
  TOPICS,
} from "./topics";

describe("normaliseCategory", () => {
  it("decodes entities that drafts sometimes store pre-escaped", () => {
    expect(normaliseCategory("Fraud &amp; Cybersecurity")).toBe("Fraud & Cybersecurity");
    expect(normaliseCategory("Fraud &amp;amp; Cybersecurity")).toBe("Fraud & Cybersecurity");
    expect(normaliseCategory("  AI  &#38; Finance ")).toBe("AI & Finance");
  });
});

describe("topicForCategory", () => {
  it("maps launch categories to one canonical hub", () => {
    expect(topicForCategory("Payments")?.slug).toBe("payments");
    expect(topicForCategory("Fintech for Business")?.slug).toBe("payments");
    expect(topicForCategory("Crypto, Stablecoins &amp; Tokenisation")?.slug).toBe(
      "fintech-regulation",
    );
    expect(topicForCategory("fraud & cybersecurity")?.slug).toBe("fraud-security");
  });

  it("leaves unowned categories without a hub", () => {
    expect(topicForCategory("Lending")).toBeNull();
    expect(topicForCategory(null)).toBeNull();
  });

  it("gives every category at most one hub", () => {
    const owned = TOPICS.flatMap((topic) => topic.categories.map(normaliseCategory));
    expect(new Set(owned).size).toBe(owned.length);
  });
});

describe("storedCategoryVariants", () => {
  it("matches both clean and escaped stored spellings", () => {
    expect(storedCategoryVariants(["Fraud & Cybersecurity"])).toEqual([
      "Fraud & Cybersecurity",
      "Fraud &amp; Cybersecurity",
    ]);
  });
});

describe("getTopic", () => {
  it("resolves the five launch hubs", () => {
    expect(TOPICS.map((topic) => topic.slug)).toEqual([
      "payments",
      "open-banking",
      "fintech-regulation",
      "fraud-security",
      "uk-fintech-funding",
    ]);
    expect(getTopic("open-banking")?.title).toBe("UK open banking news and analysis");
    expect(getTopic("lending")).toBeNull();
  });
});

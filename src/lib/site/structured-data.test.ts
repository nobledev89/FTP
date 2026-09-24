import { describe, expect, it } from "vitest";

import { ORGANIZATION_ID, type PublisherFacts } from "./config";
import {
  authorEntity,
  authorHref,
  authorSlug,
  breadcrumbList,
  jsonLd,
  organizationEntity,
} from "./structured-data";

const emptyFacts: PublisherFacts = {
  legalName: null,
  location: null,
  foundingYear: null,
  editor: null,
  sameAs: [],
};

describe("author entities", () => {
  it("builds stable profile paths", () => {
    expect(authorSlug("FinTechPulse Editorial")).toBe("fintechpulse-editorial");
    expect(authorHref("Zoë O'Brien & Co")).toBe("/authors/zoe-o-brien-and-co");
  });

  it("describes the desk byline as a unit of the publisher, never a person", () => {
    expect(authorEntity("FinTechPulse Editorial")).toMatchObject({
      "@type": "Organization",
      url: "https://fintechpulse.co.uk/authors/fintechpulse-editorial",
      parentOrganization: { "@id": ORGANIZATION_ID },
    });
    expect(authorEntity("Jane Smith")).toMatchObject({
      "@type": "Person",
      url: "https://fintechpulse.co.uk/authors/jane-smith",
    });
  });
});

describe("organizationEntity", () => {
  it("omits unconfirmed publisher facts", () => {
    const entity = organizationEntity(emptyFacts);
    expect(entity["@id"]).toBe(ORGANIZATION_ID);
    for (const key of ["legalName", "foundingDate", "sameAs", "location"]) {
      expect(entity).not.toHaveProperty(key);
    }
  });

  it("includes confirmed facts", () => {
    const entity = organizationEntity({
      ...emptyFacts,
      sameAs: ["https://www.linkedin.com/company/example"],
    });
    expect(entity).toMatchObject({ sameAs: ["https://www.linkedin.com/company/example"] });
  });

  it("points readers to the contact form, never to an email address", () => {
    const entity = organizationEntity(emptyFacts);
    expect(entity.contactPoint).toMatchObject({ url: "https://fintechpulse.co.uk/contact" });
    expect(JSON.stringify(entity)).not.toMatch(/@[a-z0-9-]+\./i);
  });
});

describe("breadcrumbList", () => {
  it("numbers items and makes URLs absolute", () => {
    expect(
      breadcrumbList([
        { name: "Home", href: "/" },
        { name: "Payments", href: "/topics/payments" },
      ]).itemListElement,
    ).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://fintechpulse.co.uk" },
      {
        "@type": "ListItem",
        position: 2,
        name: "Payments",
        item: "https://fintechpulse.co.uk/topics/payments",
      },
    ]);
  });
});

describe("jsonLd", () => {
  it("cannot close the surrounding script element", () => {
    expect(jsonLd({ headline: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});

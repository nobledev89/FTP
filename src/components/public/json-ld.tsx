import { jsonLd } from "@/lib/site/structured-data";

type JsonLdProps = {
  data: unknown;
};

export function JsonLd({ data }: JsonLdProps) {
  return <script dangerouslySetInnerHTML={{ __html: jsonLd(data) }} type="application/ld+json" />;
}

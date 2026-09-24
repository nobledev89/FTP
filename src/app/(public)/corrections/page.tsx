import { InfoPage, infoPageMetadata } from "@/components/public/info-page";
import { correctionsPage } from "@/lib/site/trust-pages";

const page = correctionsPage();

export const metadata = infoPageMetadata(page);

export default function CorrectionsPage() {
  return <InfoPage page={page} />;
}

import { InfoPage, infoPageMetadata } from "@/components/public/info-page";
import { aboutPage } from "@/lib/site/trust-pages";

const page = aboutPage();

export const metadata = infoPageMetadata(page);

export default function AboutPage() {
  return <InfoPage page={page} />;
}

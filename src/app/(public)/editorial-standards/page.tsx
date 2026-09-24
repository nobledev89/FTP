import { InfoPage, infoPageMetadata } from "@/components/public/info-page";
import { editorialStandardsPage } from "@/lib/site/trust-pages";

const page = editorialStandardsPage();

export const metadata = infoPageMetadata(page);

export default function EditorialStandardsPage() {
  return <InfoPage page={page} />;
}

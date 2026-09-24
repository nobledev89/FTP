import { InfoPage, infoPageMetadata } from "@/components/public/info-page";
import { aiPolicyPage } from "@/lib/site/trust-pages";

const page = aiPolicyPage();

export const metadata = infoPageMetadata(page);

export default function AiPolicyPage() {
  return <InfoPage page={page} />;
}

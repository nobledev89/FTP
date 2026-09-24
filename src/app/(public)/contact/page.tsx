import { ContactForm } from "@/components/public/contact-form";
import { InfoPage, infoPageMetadata } from "@/components/public/info-page";
import { contactPage } from "@/lib/site/trust-pages";

const page = contactPage();

export const metadata = infoPageMetadata(page);

export default function ContactPage() {
  return (
    <InfoPage page={page}>
      <ContactForm />
    </InfoPage>
  );
}

/** The one published contact for One Life. Shared so the two legal documents cannot end up
 *  naming different addresses, and so a change lands in one place. */
export const CONTACT_EMAIL = "admin@dayzonelife.com";

export function MailTo() {
  return (
    <a
      className="underline decoration-red decoration-2 underline-offset-2"
      href={`mailto:${CONTACT_EMAIL}`}
    >
      {CONTACT_EMAIL}
    </a>
  );
}

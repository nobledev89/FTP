"use client";

import { useActionState, useEffect, useRef } from "react";

import { submitContactForm } from "@/lib/contact/actions";
import { CONTACT_TOPICS } from "@/lib/contact/message";
import { idleContactFormState } from "@/lib/contact/state";

const labelClass = "font-mono text-[11px] uppercase tracking-[0.18em] text-subtle";
const controlClass =
  "mt-2 w-full rounded-sm border border-line bg-paper px-3 py-2.5 text-base leading-7 text-ink transition-colors placeholder:text-subtle hover:border-muted focus:border-ink";

/** Reader contact form. The destination address is server-side only and never reaches the page. */
export function ContactForm() {
  const [state, action, pending] = useActionState(submitContactForm, idleContactFormState);
  // Stamped after hydration, so the server can tell a person from an instant automated post.
  const startedAt = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (startedAt.current) startedAt.current.value = String(Date.now());
  }, []);

  if (state.status === "sent") {
    return (
      <p
        className="mt-10 border-l-2 border-signal bg-signal-soft px-5 py-4 text-base leading-7 text-ink"
        role="status"
      >
        {state.message}
      </p>
    );
  }

  return (
    <form action={action} className="mt-10 grid max-w-prose-measure gap-6" noValidate>
      <input defaultValue="" name="startedAt" ref={startedAt} type="hidden" />
      {/* Honeypot: invisible to people and assistive technology; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input autoComplete="off" id="contact-website" name="website" tabIndex={-1} type="text" />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="contact-name">
            Your name
          </label>
          <input
            autoComplete="name"
            className={controlClass}
            id="contact-name"
            maxLength={120}
            name="name"
            required
            type="text"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="contact-email">
            Your email
          </label>
          <input
            autoComplete="email"
            className={controlClass}
            id="contact-email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="contact-topic">
          What is it about?
        </label>
        <select className={controlClass} defaultValue="" id="contact-topic" name="topic" required>
          <option disabled value="">
            Choose one
          </option>
          {CONTACT_TOPICS.map((topic) => (
            <option key={topic.value} value={topic.value}>
              {topic.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="contact-article">
          Article address (optional)
        </label>
        <input
          className={controlClass}
          id="contact-article"
          inputMode="url"
          maxLength={500}
          name="articleUrl"
          placeholder="https://fintechpulse.co.uk/blog/…"
          type="url"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="contact-message">
          Message
        </label>
        <textarea
          className={`${controlClass} min-h-48`}
          id="contact-message"
          maxLength={5000}
          name="message"
          required
        />
      </div>

      {state.status === "error" ? (
        <p className="border-l-2 border-ink px-5 py-1 text-base leading-7 text-ink" role="alert">
          {state.message}
        </p>
      ) : null}

      <div>
        <button
          className="inline-flex min-h-11 items-center bg-ink px-6 font-mono text-[11px] uppercase tracking-[0.24em] text-paper transition-colors hover:bg-muted disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}

"use client";
/**
 * The notice shown before a visitor on a translated page follows a link to
 * something that exists in the default language only. Mounted once in the
 * language layout; it works for every link on the page, server rendered or
 * not, through one delegated click listener.
 *
 * `state` comes from `resolveApplyNotice()` on the server:
 * - `active`: a click on a matching link opens the dialog. Continue follows
 *   the link with its own target; Cancel, Escape and a click outside close it
 *   and return focus to the link.
 * - `blocked`: matching links are removed from the page, because the notice
 *   is on and has no approved wording in this language. The layout should
 *   also print `applyNoticeHideCss()` so they are hidden before this runs.
 * - `off`, or a default-language page: nothing is rendered and nothing is
 *   listened for.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { matchesApplyHost, type ApplyNoticeState, type ApplyNoticeText } from "../../core/hosts";

export interface ExternalApplyNoticeClassNames {
  overlay?: string;
  dialog?: string;
  title?: string;
  body?: string;
  actions?: string;
  continue?: string;
  cancel?: string;
}

export interface ExternalApplyNoticeProps {
  /** The language of the page. */
  lang: string;
  /** The default language. The component does nothing on a page in it. */
  defaultId: string;
  state: ApplyNoticeState;
  /** The host patterns from `resolveApplyNotice()`. */
  hosts: readonly string[];
  /** The words, in the page's language. Required when `state` is `active`. */
  notice?: ApplyNoticeText;
  classNames?: ExternalApplyNoticeClassNames;
}

interface Pending {
  href: string;
  target: string;
  rel: string;
  trigger: HTMLAnchorElement;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
  const element = target instanceof Element ? target.closest("a[href]") : null;
  return element instanceof HTMLAnchorElement ? element : null;
}

export function ExternalApplyNotice(props: ExternalApplyNoticeProps) {
  const { lang, defaultId, state, hosts, notice, classNames = {} } = props;
  const [pending, setPending] = useState<Pending | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const translated = lang !== defaultId;
  const active = translated && state === "active" && !!notice && hosts.length > 0;
  const blocked = translated && state === "blocked" && hosts.length > 0;

  // Active: one listener for every link on the page, present and future.
  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      const anchor = anchorOf(event.target);
      if (!anchor || anchor.hasAttribute("data-i18n-apply-continue")) return;
      if (!matchesApplyHost(anchor.getAttribute("href"), hosts, window.location.href)) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ href: anchor.href, target: anchor.target || "", rel: anchor.rel || "", trigger: anchor });
    };
    // Capture phase, so the notice comes before any handler on the link itself. `auxclick` covers a middle click.
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [active, hosts]);

  // Blocked: take matching links out of the page, now and as the page changes.
  useEffect(() => {
    if (!blocked) return;
    const sweep = (root: ParentNode) => {
      root.querySelectorAll("a[href]").forEach((anchor) => {
        if (matchesApplyHost(anchor.getAttribute("href"), hosts, window.location.href)) anchor.remove();
      });
    };
    sweep(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node instanceof HTMLAnchorElement && matchesApplyHost(node.getAttribute("href"), hosts, window.location.href)) node.remove();
          else sweep(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [blocked, hosts]);

  const close = useCallback(() => {
    setPending((current) => {
      // Back to where the visitor was.
      if (current?.trigger.isConnected) current.trigger.focus();
      return null;
    });
  }, []);

  // While open: focus moves in, Tab stays in, Escape closes, the page behind does not scroll.
  useEffect(() => {
    if (!pending) return;
    const dialog = dialogRef.current;
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables()[0] ?? dialog)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !dialog?.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !dialog?.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [pending, close]);

  if (!active || !pending || !notice) return null;

  const paragraphs = notice.body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "");
  const newTab = pending.target !== "" && pending.target !== "_self";
  const rel = newTab ? Array.from(new Set([...pending.rel.split(/\s+/).filter(Boolean), "noopener"])).join(" ") : pending.rel || undefined;

  return (
    <div
      data-i18n-apply-notice
      className={classNames.overlay}
      style={classNames.overlay ? undefined : { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.55)" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        lang={lang}
        tabIndex={-1}
        className={classNames.dialog}
        style={classNames.dialog ? undefined : { width: "100%", maxWidth: 520, maxHeight: "calc(100vh - 40px)", overflowY: "auto", background: "#fff", color: "#111", padding: 28 }}
      >
        <h2 id={titleId} className={classNames.title} style={classNames.title ? undefined : { margin: 0, fontSize: 22, lineHeight: 1.25 }}>
          {notice.title}
        </h2>
        <div id={bodyId} className={classNames.body} style={classNames.body ? undefined : { marginTop: 12, fontSize: 16, lineHeight: 1.5 }}>
          {paragraphs.map((paragraph, index) => (
            <p key={index} style={index > 0 ? { marginTop: 12 } : undefined}>
              {paragraph}
            </p>
          ))}
        </div>
        <div className={classNames.actions} style={classNames.actions ? undefined : { marginTop: 24, display: "flex", flexWrap: "wrap", gap: 12 }}>
          <a
            data-i18n-apply-continue
            href={pending.href}
            target={pending.target || undefined}
            rel={rel}
            hrefLang={defaultId}
            className={classNames.continue}
            onClick={() => setPending(null)}
          >
            {notice.continueLabel}
          </a>
          <button type="button" className={classNames.cancel} onClick={close}>
            {notice.cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

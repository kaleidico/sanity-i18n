"use client";

// src/next/client/index.tsx
import { useEffect as useEffect2, useState as useState2 } from "react";

// src/next/client/ExternalApplyNotice.tsx
import { useCallback, useEffect, useId, useRef, useState } from "react";

// src/core/hosts.ts
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
function linkHost(href, base) {
  const value = text(href);
  if (value === "") return null;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
  if (!absolute && !base) return null;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}
function hostMatches(host, pattern) {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}
function matchesApplyHost(href, patterns, base) {
  const host = linkHost(href, base);
  if (!host) return false;
  return patterns.some((pattern) => hostMatches(host, pattern));
}

// src/next/client/ExternalApplyNotice.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
function anchorOf(target) {
  const element = target instanceof Element ? target.closest("a[href]") : null;
  return element instanceof HTMLAnchorElement ? element : null;
}
function ExternalApplyNotice(props) {
  const { lang, defaultId, state, hosts, notice, classNames = {} } = props;
  const [pending, setPending] = useState(null);
  const dialogRef = useRef(null);
  const titleId = useId();
  const bodyId = useId();
  const translated = lang !== defaultId;
  const active = translated && state === "active" && !!notice && hosts.length > 0;
  const blocked = translated && state === "blocked" && hosts.length > 0;
  useEffect(() => {
    if (!active) return;
    const onClick = (event) => {
      const anchor = anchorOf(event.target);
      if (!anchor || anchor.hasAttribute("data-i18n-apply-continue")) return;
      if (!matchesApplyHost(anchor.getAttribute("href"), hosts, window.location.href)) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ href: anchor.href, target: anchor.target || "", rel: anchor.rel || "", trigger: anchor });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [active, hosts]);
  useEffect(() => {
    if (!blocked) return;
    const sweep = (root) => {
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
      if (current?.trigger.isConnected) current.trigger.focus();
      return null;
    });
  }, []);
  useEffect(() => {
    if (!pending) return;
    const dialog = dialogRef.current;
    const focusables = () => Array.from(dialog?.querySelectorAll(FOCUSABLE) ?? []);
    (focusables()[0] ?? dialog)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => {
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
  const rel = newTab ? Array.from(/* @__PURE__ */ new Set([...pending.rel.split(/\s+/).filter(Boolean), "noopener"])).join(" ") : pending.rel || void 0;
  return /* @__PURE__ */ jsx(
    "div",
    {
      "data-i18n-apply-notice": true,
      className: classNames.overlay,
      style: classNames.overlay ? void 0 : { position: "fixed", inset: 0, zIndex: 1e3, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.55)" },
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) close();
      },
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          ref: dialogRef,
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": titleId,
          "aria-describedby": bodyId,
          lang,
          tabIndex: -1,
          className: classNames.dialog,
          style: classNames.dialog ? void 0 : { width: "100%", maxWidth: 520, maxHeight: "calc(100vh - 40px)", overflowY: "auto", background: "#fff", color: "#111", padding: 28 },
          children: [
            /* @__PURE__ */ jsx("h2", { id: titleId, className: classNames.title, style: classNames.title ? void 0 : { margin: 0, fontSize: 22, lineHeight: 1.25 }, children: notice.title }),
            /* @__PURE__ */ jsx("div", { id: bodyId, className: classNames.body, style: classNames.body ? void 0 : { marginTop: 12, fontSize: 16, lineHeight: 1.5 }, children: paragraphs.map((paragraph, index) => /* @__PURE__ */ jsx("p", { style: index > 0 ? { marginTop: 12 } : void 0, children: paragraph }, index)) }),
            /* @__PURE__ */ jsxs("div", { className: classNames.actions, style: classNames.actions ? void 0 : { marginTop: 24, display: "flex", flexWrap: "wrap", gap: 12 }, children: [
              /* @__PURE__ */ jsx(
                "a",
                {
                  "data-i18n-apply-continue": true,
                  href: pending.href,
                  target: pending.target || void 0,
                  rel,
                  hrefLang: defaultId,
                  className: classNames.continue,
                  onClick: () => setPending(null),
                  children: notice.continueLabel
                }
              ),
              /* @__PURE__ */ jsx("button", { type: "button", className: classNames.cancel, onClick: close, children: notice.cancelLabel })
            ] })
          ]
        }
      )
    }
  );
}

// src/next/client/index.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var DEFAULT_KEY = "i18n-suggestion-dismissed";
var DAY = 24 * 60 * 60 * 1e3;
function pickSuggestedLanguage(preferred, languages, defaultId) {
  const candidates = languages.filter((l) => l.id !== defaultId);
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split("-")[0];
    const exact = candidates.find((l) => l.id.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const byPrimary = candidates.find((l) => l.id.toLowerCase().split("-")[0] === primary);
    if (byPrimary) return byPrimary;
    if (primary === defaultId.toLowerCase().split("-")[0]) return void 0;
  }
  return void 0;
}
function readDismissed(key, days) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < days * DAY;
  } catch {
    return false;
  }
}
function writeDismissed(key) {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
  }
}
function LanguageSuggestion(props) {
  const { current, defaultId, languages, links, labels, days = 30, storageKey = DEFAULT_KEY } = props;
  const [suggested, setSuggested] = useState2(null);
  useEffect2(() => {
    if (current !== defaultId) return;
    if (readDismissed(storageKey, days)) return;
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
    const pick = pickSuggestedLanguage(preferred, languages, defaultId);
    if (!pick || !labels[pick.id] || !links[pick.id]) return;
    setSuggested(pick);
  }, [current, defaultId, languages, links, labels, days, storageKey]);
  if (!suggested) return null;
  const text2 = labels[suggested.id];
  const href = links[suggested.id];
  const dismiss = () => {
    writeDismissed(storageKey);
    setSuggested(null);
  };
  return /* @__PURE__ */ jsxs2("div", { role: "region", "aria-label": text2.link, lang: suggested.id, "data-i18n-suggestion": true, className: props.className, children: [
    /* @__PURE__ */ jsxs2("p", { className: props.textClassName, children: [
      text2.text,
      " ",
      /* @__PURE__ */ jsx2("a", { href, hrefLang: suggested.id, lang: suggested.id, className: props.linkClassName, children: text2.link })
    ] }),
    /* @__PURE__ */ jsx2("button", { type: "button", onClick: dismiss, "aria-label": text2.dismiss, className: props.dismissClassName, children: props.dismissIcon ?? "\xD7" })
  ] });
}
export {
  ExternalApplyNotice,
  LanguageSuggestion,
  hostMatches,
  linkHost,
  matchesApplyHost,
  pickSuggestedLanguage
};
//# sourceMappingURL=index.js.map
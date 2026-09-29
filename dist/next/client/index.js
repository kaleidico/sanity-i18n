"use client";

// src/next/client/index.tsx
import { useEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
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
  const [suggested, setSuggested] = useState(null);
  useEffect(() => {
    if (current !== defaultId) return;
    if (readDismissed(storageKey, days)) return;
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
    const pick = pickSuggestedLanguage(preferred, languages, defaultId);
    if (!pick || !labels[pick.id] || !links[pick.id]) return;
    setSuggested(pick);
  }, [current, defaultId, languages, links, labels, days, storageKey]);
  if (!suggested) return null;
  const text = labels[suggested.id];
  const href = links[suggested.id];
  const dismiss = () => {
    writeDismissed(storageKey);
    setSuggested(null);
  };
  return /* @__PURE__ */ jsxs("div", { role: "region", "aria-label": text.link, lang: suggested.id, "data-i18n-suggestion": true, className: props.className, children: [
    /* @__PURE__ */ jsxs("p", { className: props.textClassName, children: [
      text.text,
      " ",
      /* @__PURE__ */ jsx("a", { href, hrefLang: suggested.id, lang: suggested.id, className: props.linkClassName, children: text.link })
    ] }),
    /* @__PURE__ */ jsx("button", { type: "button", onClick: dismiss, "aria-label": text.dismiss, className: props.dismissClassName, children: props.dismissIcon ?? "\xD7" })
  ] });
}
export {
  LanguageSuggestion,
  pickSuggestedLanguage
};
//# sourceMappingURL=index.js.map
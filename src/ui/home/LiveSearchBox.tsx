"use client";

// A client component because it needs to react to typing, debounce, and update the URL without a full page reload.
// The plain GET form still works with no JavaScript; this enhances the experience when JS is available.
// It also captures text typed before hydration and cancels the pending live search on Enter.

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { t } from "@/src/i18n";

export function LiveSearchBox({ typed }: { typed: string | undefined }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(typed ?? "");
  const [pending, startTransition] = useTransition();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountHandledRef = useRef(false);
  const skipTypedEffectRef = useRef(false);

  // The value this box last put in the URL. When the page comes back with it, the dancer may have
  // typed on meanwhile, so the box keeps what they typed; any other change (Back, a link) resets it.
  const sentRef = useRef<string | null>(null);

  const updateUrl = (newValue: string) => {
    const trimmed = newValue.trim();
    const next = new URLSearchParams(searchParams.toString());
    // Remove filters sheet when searching (consistent with current behavior)
    next.delete("filters");
    if (trimmed === "") {
      next.delete("place");
    } else {
      next.set("place", trimmed);
    }
    next.sort();
    const nextString = next.toString();
    const current = new URLSearchParams(searchParams.toString());
    current.sort();
    if (nextString === current.toString()) return;
    sentRef.current = trimmed;

    startTransition(() => {
      router.replace(`/?${nextString}`, { scroll: false });
    });
  };

  // On mount: read DOM value, start debounce if needed, attach submit listener.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const domValue = input.value;
    const initialValue = typed ?? "";
    if (domValue !== initialValue) {
      // Dancer typed before hydration.
      setValue(domValue);
      // Clear any existing timer and start a new one, exactly as handleChange does.
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        updateUrl(domValue);
      }, 350);
      skipTypedEffectRef.current = true;
    }

    const form = input.form;
    const handleSubmit = () => {
      // Clear pending debounce timer on form submit (Enter).
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Do NOT preventDefault: native GET submit proceeds.
    };
    if (form) {
      form.addEventListener("submit", handleSubmit);
    }

    mountHandledRef.current = true;

    return () => {
      if (form) {
        form.removeEventListener("submit", handleSubmit);
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync with URL changes (Back, link clicks) but skip first run if we already set value from DOM.
  useEffect(() => {
    if (!mountHandledRef.current) return;
    if (skipTypedEffectRef.current) {
      skipTypedEffectRef.current = false;
      return;
    }
    if ((typed ?? "") === sentRef.current) return;
    setValue(typed ?? "");
  }, [typed]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      updateUrl(newValue);
    }, 350);
  };

  const handleClear = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setValue("");
    sentRef.current = "";
    const next = new URLSearchParams(searchParams.toString());
    next.delete("place");
    next.delete("filters");
    next.sort();
    startTransition(() => {
      router.replace(`/?${next.toString()}`, { scroll: false });
    });
    // Focus the input after clearing
    const input = inputRef.current;
    if (input) input.focus();
  };

  const hasText = value.trim() !== "";

  return (
    <>
      <label htmlFor="place" className="sr-only">
        {t("home.location.searchLabel")}
      </label>
      <input
        ref={inputRef}
        id="place"
        name="place"
        type="search"
        autoComplete="off"
        value={value}
        onChange={handleChange}
        placeholder={t("home.location.searchPlaceholder")}
        aria-busy={pending}
        className="chip-edge bg-paper text-ink placeholder:text-toner type-body min-h-11 min-w-0 flex-1 rounded-control px-3"
      />
      {hasText ? (
        <button
          key="clear"
          type="button"
          onClick={handleClear}
          className="bg-ink text-paper type-button min-h-11 rounded-control px-4"
        >
          {t("home.location.clearButton")}
        </button>
      ) : (
        <button
          key="search"
          type="submit"
          className="bg-ink text-paper type-button min-h-11 rounded-control px-4"
        >
          {t("home.location.searchButton")}
        </button>
      )}
    </>
  );
}

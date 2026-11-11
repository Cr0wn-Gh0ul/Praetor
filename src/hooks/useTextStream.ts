"use client";

import { useEffect, useRef, useState } from "react";

type StreamState = "idle" | "streaming" | "done" | "error";

export type StreamResult = {
  status: "done" | "error" | "aborted";
  text: string;
  headers: Headers | null;
  error?: string;
};

export function useTextStream() {
  const [text, setText] = useState("");
  const [state, setState] = useState<StreamState>("idle");
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function start(url: string, body: unknown, options: { onHeaders?: (headers: Headers) => void } = {}): Promise<StreamResult> {
    controller.current?.abort();
    const activeController = new AbortController();
    controller.current = activeController;
    setText("");
    setError(null);
    setState("streaming");
    let collected = "";
    let headers: Headers | null = null;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: activeController.signal,
      });
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        const message = typeof result === "object" && result !== null && "error" in result
          ? String((result.error as { message?: unknown }).message ?? "Request failed.")
          : "Request failed.";
        throw new Error(message);
      }
      if (!response.body) throw new Error("The server returned an empty stream.");
      headers = response.headers;
      options.onHeaders?.(response.headers);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const piece = decoder.decode(value, { stream: true });
          if (piece) {
            collected += piece;
            setText(collected);
          }
        }
      } catch {
        if (activeController.signal.aborted) throw new Error("aborted");
        throw new Error("The model stopped before finishing. Try again or choose another model.");
      }
      collected += decoder.decode();
      setText(collected);
      setState("done");
      return { status: "done", text: collected, headers };
    } catch (cause) {
      if (activeController.signal.aborted) return { status: "aborted", text: collected, headers };
      const message = cause instanceof Error ? cause.message : "The request failed.";
      setState("error");
      setError(message);
      return { status: "error", text: collected, headers, error: message };
    }
  }

  function stop() {
    controller.current?.abort();
    setState("idle");
  }

  function reset() {
    controller.current?.abort();
    setText("");
    setError(null);
    setState("idle");
  }

  return { text, state, error, start, stop, reset };
}
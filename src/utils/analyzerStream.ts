/** Where the analyzer is with one statement, as it reports it while working. */
export interface AnalyzerProgress {
  pct: number;
  stage: "reading" | "classifying" | "checking" | "summary" | "saving" | string;
  done: number;
  expected: number | null;
}

/** Reads the analyzer's answer. With live progress it is one JSON line per update and a last line with
 * the result (or the error); `raw` keeps everything for answers in the older single-JSON shape. */
export const readAnalyzerAnswer = async (response: Response, onProgress: (p: AnalyzerProgress) => void) => {
  let raw = "";
  let result: unknown = undefined;
  let error: string | null = null;
  const handleLine = (line: string) => {
    const text = line.trim();
    if (!text) return;
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg?.type === "progress") {
      onProgress({
        pct: Number(msg.pct) || 0,
        stage: String(msg.stage || ""),
        done: Number(msg.done) || 0,
        expected: typeof msg.expected === "number" && msg.expected > 0 ? msg.expected : null,
      });
    } else if (msg?.type === "result") result = msg.data;
    else if (msg?.type === "error") error = typeof msg.error === "string" ? msg.error : "";
  };
  if (!response.ok || !response.body) {
    raw = await response.text().catch(() => "");
    return { raw, result, error };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        handleLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }
    const rest = decoder.decode();
    raw += rest;
    pending += rest;
    if (pending.trim() && result === undefined && error === null) handleLine(pending);
  } catch (streamError) {
    console.error("Analyze stream interrupted:", streamError);
  }
  return { raw, result, error };
};

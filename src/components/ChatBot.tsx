import { useState, useRef, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, X, Send, Loader2, Bot, User, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Msg = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/financial-advisor`;

const suggestionsEN = [
  "How can I save more money?",
  "Tips to reduce my expenses",
  "How to create a budget?",
];
const suggestionsES = [
  "¿Cómo puedo ahorrar más dinero?",
  "Tips para reducir mis gastos",
  "¿Cómo crear un presupuesto?",
];

const ChatBot = () => {
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = lang === "es" ? suggestionsES : suggestionsEN;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Msg = { role: "user", content: text.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: allMessages, lang }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error("Stream failed");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            const c = parsed.choices?.[0]?.delta?.content ?? parsed.delta?.text;
            if (c) upsert(c);
          } catch { /* partial */ }
        }
      }
    } catch {
      upsert(lang === "es"
        ? "\n\n⚠️ No pude conectarme. Intenta de nuevo."
        : "\n\n⚠️ Couldn't connect. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, lang]);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 hover:scale-110 ${
          open
            ? "bg-muted text-muted-foreground rotate-90"
            : "bg-primary text-primary-foreground neon-glow"
        }`}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[360px] max-h-[520px] flex flex-col rounded-2xl border border-border bg-card shadow-2xl animate-scale-in overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-foreground">CTRL+ Advisor</p>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                {lang === "es" ? "En línea • Asesor financiero IA" : "Online • AI Financial Advisor"}
              </p>
            </div>
            <Sparkles className="h-4 w-4 text-primary" />
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[280px] max-h-[340px]">
            {messages.length === 0 && (
              <div className="space-y-3 animate-fade-in">
                <div className="text-center py-4">
                  <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-3 animate-pulse-glow">
                    <Bot className="h-7 w-7 text-primary" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {lang === "es" ? "¡Hola! Soy tu asesor financiero" : "Hi! I'm your financial advisor"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {lang === "es" ? "Pregúntame lo que quieras sobre finanzas" : "Ask me anything about finances"}
                  </p>
                </div>
                <div className="space-y-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="w-full text-left text-xs px-3 py-2 rounded-lg bg-muted/50 border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all duration-200"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-xl text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm prose-invert max-w-none [&>p]:m-0 [&>ul]:my-1 [&>ol]:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-2 animate-fade-in">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-muted px-4 py-3 rounded-xl rounded-bl-sm">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border bg-background/80 backdrop-blur-sm">
            <form
              onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={lang === "es" ? "Escribe tu pregunta..." : "Type your question..."}
                className="flex-1 h-9 text-sm bg-muted border-border/50 focus:border-primary/50"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim() || isLoading}
                className="h-9 w-9 p-0 neon-glow"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatBot;

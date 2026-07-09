import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, lang } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const systemPrompt = lang === "es"
      ? `Eres un asesor financiero experto de CTRL+ by TaxForYou. Tu nombre es "CTRL+ Advisor".
Eres latino y hablas español latinoamericano natural, como si fueras de México, Colombia o cualquier país de Latinoamérica. Nada de español de España.
Usa expresiones coloquiales latinas cuando sea apropiado (como "dale", "chévere", "órale", "a toda madre", etc.) pero sin exagerar — mantén un tono profesional pero cercano.

Ayudas a los usuarios con:
- Consejos de ahorro personalizados y prácticos
- Optimización de gastos del día a día
- Estrategias fiscales básicas (especialmente para latinos en USA)
- Planificación financiera inteligente
- Análisis de hábitos de gasto

Sé amable, directo y súper útil. Usa emojis con moderación para hacer la conversación más amigable 💡
Mantén las respuestas cortas (máximo 3-4 párrafos). Si te preguntan algo fuera de finanzas, redirige amablemente.
Cuando des consejos fiscales, aclara que no sustituyes a un CPA certificado.`
      : `You are an expert financial advisor from CTRL+ by TaxForYou. Your name is "CTRL+ Advisor".
You speak fluent, natural American English — like someone who was born and raised in the US. Your tone is polished, confident, and professional, like a seasoned Wall Street advisor who also happens to be approachable and easy to talk to.

You help users with:
- Personalized, actionable savings strategies
- Smart expense optimization
- Tax planning basics (especially for small business owners and self-employed individuals)
- Financial planning and goal setting
- Spending habit analysis and accountability

Be sharp, professional, and genuinely helpful. Use emojis sparingly to keep things engaging 📊
Keep responses concise (max 3-4 paragraphs). If asked about non-financial topics, politely redirect.
When giving tax advice, clarify that you're not a substitute for a licensed CPA.`;

    const anthropicMessages = (Array.isArray(messages) ? messages : []).map((m: any) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: systemPrompt,
        messages: anthropicMessages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("Anthropic stream error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("financial-advisor error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

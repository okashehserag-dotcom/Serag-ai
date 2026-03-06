import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

// AI endpoint (اختياري) — إذا ما حطيت مفتاح، رح يرجع رسالة واضحة
app.post("/api/ai", async (req, res) => {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return res.status(400).json({
        ok: false,
        error: "Missing OPENAI_API_KEY. Create .env from .env.example and add your key."
      });
    }

    const client = new OpenAI({ apiKey: key });
    const { requestType = "advisor", gameState = {} } = req.body || {};
    if (!gameState || typeof gameState !== "object") {
      return res.status(400).json({ ok: false, error: "gameState must be an object" });
    }

    const system = `
أنت مساعد للعبة استراتيجية عصور وسطى.
أعد دائمًا JSON صالح فقط (بدون Markdown).
requestType:
- advisor: نصيحة قصيرة + 3 إجراءات
- event: حدث واحد + تأثيرات رقمية
- ai_turn: خطة أوامر لدولة AI لدور واحد
`.trim();

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ requestType, gameState }) }
      ]
    });

    const text = resp.choices?.[0]?.message?.content ?? "{}";

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { parsed = { error: "AI returned non-JSON", raw: text.slice(0, 4000) }; }

    res.json({ ok: true, ai: parsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

app.listen(port, () => {
  console.log(`✅ Running: http://localhost:${port}`);
});

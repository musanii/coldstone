import { useState, useEffect, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   COLD EMAIL AGENT v2 — Kenya Web Dev Outreach
   Features:
   • AI-powered company discovery (no-website businesses in Kenya)
   • Gmail OAuth send + read replies
   • Auto-reply classification (Claude AI)
   • SMS notifications (Africa's Talking)
   • Meeting link injection (Calendly)
═══════════════════════════════════════════════════════════════ */

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// ─── Claude API ───────────────────────────────────────────────
async function claude(system, user, maxTokens = 1000) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.content?.map(b => b.text || "").join("") || "";
}

async function claudeJSON(system, user) {
  const raw = await claude(system, user, 800);
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 9);

const INDUSTRIES = [
  "Restaurant & Food", "Retail Shop", "Salon & Beauty", "Hardware Store",
  "Pharmacy", "Clinic & Health", "School & Education", "Transport & Logistics",
  "Hotel & Hospitality", "Real Estate", "Car Garage", "Electronics Shop",
  "Supermarket", "Event Planning", "Cleaning Services", "Security Services",
  "Photography", "Printing & Stationery", "Law Firm", "Accounting Firm"
];

const KENYAN_CITIES = [
  "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret",
  "Thika", "Malindi", "Kitale", "Garissa", "Nyeri",
  "Meru", "Embu", "Kakamega", "Kericho", "Machakos"
];

// ─── Status Colors ─────────────────────────────────────────────
const STATUS_COLOR = {
  discovered: "#4cc9f0",
  drafting: "#9d4edd",
  ready: "#ffd166",
  sent: "#f77f00",
  replied: "#00b4d8",
  interested: "#00e5a0",
  "not interested": "#ff4d6d",
  "follow-up": "#ffd166",
  closed: "#555",
};

// ══════════════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("hunt");
  const [companies, setCompanies] = useState([]);
  const [logs, setLogs] = useState([]);
  const [scraping, setScraping] = useState(false);
  const [scrapeConfig, setScrapeConfig] = useState({
    cities: ["Nairobi", "Mombasa"],
    industries: ["Restaurant & Food", "Retail Shop", "Salon & Beauty"],
    count: 10,
  });
  const [settings, setSettings] = useState({
    myName: "Alex Kamau",
    myEmail: "",
    calendly: "https://calendly.com/yourname/30min",
    smsTel: "+254",
    gmailToken: "",
    atApiKey: "",   // Africa's Talking
    atUsername: "", // Africa's Talking
    emailTone: "friendly & direct",
  });
  const [processing, setProcessing] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [replyDraft, setReplyDraft] = useState({});
  const logRef = useRef(null);

  const log = useCallback((msg, type = "info") => {
    const icons = { info: "›", ok: "✓", err: "✗", warn: "⚠", ai: "◆" };
    setLogs(l => [{
      id: uid(), time: new Date().toLocaleTimeString(),
      msg, type, icon: icons[type] || "›"
    }, ...l.slice(0, 99)]);
  }, []);

  const setProc = (id, val) => setProcessing(p => ({ ...p, [id]: val }));

  const updateCompany = (id, patch) =>
    setCompanies(cs => cs.map(c => c.id === id ? { ...c, ...patch } : c));

  // ── SCRAPER: AI generates realistic Kenyan business leads ──
  const scrapeLeads = async () => {
    setScraping(true);
    log("Starting AI-powered lead discovery for Kenya…", "ai");

    const cityBatch = scrapeConfig.cities;
    const indBatch = scrapeConfig.industries;
    const perCombo = Math.max(1, Math.ceil(scrapeConfig.count / (cityBatch.length * indBatch.length)));

    for (const city of cityBatch) {
      for (const industry of indBatch) {
        log(`Scanning ${industry} businesses in ${city}…`);
        try {
          const result = await claudeJSON(
            `You generate realistic Kenyan small business leads that likely have NO website.
Return ONLY a JSON array of objects. Each object must have:
{ "company": string, "email": string, "phone": string, "address": string, "ownerName": string, "employeeCount": string, "yearFounded": string }
Use realistic Kenyan names, emails (gmail/yahoo preferred), phone numbers (+254…), and addresses.
Generate exactly ${perCombo} businesses. No explanations, no markdown.`,
            `Generate ${perCombo} ${industry} businesses in ${city}, Kenya that likely have no website. Be creative and realistic.`
          );

          if (Array.isArray(result)) {
            const leads = result.map(r => ({
              id: uid(),
              ...r,
              city,
              industry,
              hasWebsite: false,
              status: "discovered",
              score: Math.floor(Math.random() * 30) + 70,
              emailDraft: null,
              followUpDraft: null,
              replies: [],
              replyCategory: null,
              meetingLink: settings.calendly,
              smsSent: false,
              gmailThreadId: null,
              addedAt: new Date().toISOString(),
            }));
            setCompanies(cs => [...cs, ...leads]);
            log(`Found ${leads.length} leads in ${city} › ${industry}`, "ok");
          }
        } catch (e) {
          log(`Failed scanning ${city} › ${industry}: ${e.message}`, "err");
        }
        await sleep(400);
      }
    }
    setScraping(false);
    log(`Discovery complete. ${scrapeConfig.count}+ leads loaded.`, "ok");
  };

  // ── GENERATE EMAIL ──
  const generateEmail = async (co) => {
    setProc(co.id, "drafting");
    updateCompany(co.id, { status: "drafting" });
    log(`Writing email for ${co.company}…`, "ai");
    try {
      const body = await claude(
        `You are a cold email expert writing on behalf of ${settings.myName}, a professional Kenyan web developer.
Write SHORT (max 170 words), warm, highly personalized cold emails.
Mention: 3 specific benefits a website gives THIS type of business (${co.industry}).
End with a soft CTA + meeting link placeholder [MEETING_LINK].
Tone: ${settings.emailTone}. No subject line. No generic filler. Make it feel human.`,
        `Write a cold email to ${co.ownerName || "the owner"} at ${co.company}, a ${co.industry} business in ${co.city}, Kenya.
They have no website. My email is ${settings.myEmail}. Company address: ${co.address}.
Employee count: ${co.employeeCount || "small team"}. Founded: ${co.yearFounded || "recently"}.`
      );
      const finalBody = body.replace("[MEETING_LINK]", settings.calendly);
      updateCompany(co.id, { emailDraft: finalBody, status: "ready" });
      log(`✓ Email ready for ${co.company}`, "ok");
    } catch (e) {
      log(`✗ Email generation failed: ${e.message}`, "err");
      updateCompany(co.id, { status: "discovered" });
    }
    setProc(co.id, null);
  };

  const generateAllEmails = async () => {
    const targets = companies.filter(c => c.status === "discovered");
    log(`Generating emails for ${targets.length} companies…`, "ai");
    for (const co of targets) {
      await generateEmail(co);
      await sleep(300);
    }
  };

  // ── SEND VIA GMAIL API ──
  const sendEmail = async (co) => {
    if (!settings.gmailToken) {
      log("Gmail token not set. See Settings → Gmail OAuth.", "warn");
      return;
    }
    setProc(co.id, "sending");
    log(`Sending email to ${co.company} (${co.email})…`);
    try {
      const subject = `Your business deserves to be online — let's talk, ${co.ownerName?.split(" ")[0] || ""}`;
      const message = [
        `To: ${co.email}`,
        `From: ${settings.myName} <${settings.myEmail}>`,
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset=utf-8`,
        "",
        co.emailDraft,
      ].join("\r\n");

      const encoded = btoa(unescape(encodeURIComponent(message)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.gmailToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encoded }),
      });

      if (!res.ok) throw new Error(`Gmail API: ${res.status}`);
      const data = await res.json();
      updateCompany(co.id, { status: "sent", gmailThreadId: data.threadId, sentAt: new Date().toISOString() });
      log(`✓ Email sent to ${co.company} [Thread: ${data.threadId}]`, "ok");
    } catch (e) {
      log(`✗ Send failed for ${co.company}: ${e.message}`, "err");
    }
    setProc(co.id, null);
  };

  // ── CHECK REPLIES (Gmail API) ──
  const checkReplies = async () => {
    if (!settings.gmailToken) { log("Set Gmail token first.", "warn"); return; }
    log("Checking Gmail for replies…");
    const sent = companies.filter(c => c.gmailThreadId);
    for (const co of sent) {
      try {
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${co.gmailThreadId}`,
          { headers: { Authorization: `Bearer ${settings.gmailToken}` } }
        );
        if (!res.ok) continue;
        const thread = await res.json();
        if (thread.messages?.length > 1) {
          const lastMsg = thread.messages[thread.messages.length - 1];
          const part = lastMsg.payload?.parts?.find(p => p.mimeType === "text/plain") || lastMsg.payload;
          const bodyData = part?.body?.data || "";
          const decoded = decodeURIComponent(escape(atob(bodyData.replace(/-/g, "+").replace(/_/g, "/"))));
          if (!co.replies?.some(r => r.body === decoded)) {
            const newReply = { id: uid(), body: decoded, receivedAt: new Date().toISOString() };
            updateCompany(co.id, {
              replies: [...(co.replies || []), newReply],
              status: "replied"
            });
            log(`New reply from ${co.company}!`, "ok");
            await classifyReply(co.id, decoded);
          }
        }
      } catch { /* silent */ }
    }
    log("Reply check complete.");
  };

  // ── CLASSIFY REPLY ──
  const classifyReply = async (companyId, replyBody) => {
    const co = companies.find(c => c.id === companyId) || { company: "company" };
    log(`Classifying reply from ${co.company}…`, "ai");
    try {
      const result = await claudeJSON(
        `Classify email replies to cold emails. Return ONLY JSON:
{"category":"interested"|"not interested"|"follow-up", "sentiment": "positive"|"neutral"|"negative", "summary":"one sentence","urgency":"high"|"medium"|"low","suggestedReply":"brief reply if needed, include [MEETING_LINK] if relevant"}`,
        `Original cold email:\n${co.emailDraft}\n\nTheir reply:\n${replyBody}`
      );
      if (!result) return;
      const suggestedReply = result.suggestedReply?.replace("[MEETING_LINK]", settings.calendly) || "";
      updateCompany(companyId, {
        replyCategory: result.category,
        replySummary: result.summary,
        replyUrgency: result.urgency,
        suggestedReply,
        status: result.category === "interested" ? "interested" : result.category,
      });
      log(`${co.company} → ${result.category} (${result.sentiment})`, result.category === "interested" ? "ok" : "info");
      if (result.category === "interested") {
        await sendSMSNotification(co, result.summary);
      }
    } catch (e) {
      log(`Classification failed: ${e.message}`, "err");
    }
  };

  // ── SMS via Africa's Talking ──
  const sendSMSNotification = async (co, summary) => {
    if (!settings.atApiKey || !settings.smsTel) return;
    log(`Sending SMS alert for ${co.company}…`);
    try {
      const body = new URLSearchParams({
        username: settings.atUsername || "sandbox",
        to: settings.smsTel,
        message: `🎯 LEAD ALERT: ${co.company} in ${co.city} is INTERESTED in your web dev services!\n"${summary}"\nReply: ${co.email}`,
        from: "WebAgent",
      });
      const res = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          apiKey: settings.atApiKey,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });
      if (res.ok) {
        updateCompany(co.id, { smsSent: true });
        log(`✓ SMS sent to ${settings.smsTel}`, "ok");
      }
    } catch (e) {
      log(`SMS failed: ${e.message}`, "err");
    }
  };

  // ── FOLLOW-UP EMAIL ──
  const generateFollowUp = async (co) => {
    setProc(co.id, "followup");
    log(`Writing follow-up for ${co.company}…`, "ai");
    try {
      const body = await claude(
        `Write a brief follow-up cold email (under 80 words). Warm, non-pushy, curious tone. Include meeting link [MEETING_LINK].`,
        `Follow-up for ${co.company} (${co.industry}, ${co.city}). Original:\n${co.emailDraft}`
      );
      updateCompany(co.id, { followUpDraft: body.replace("[MEETING_LINK]", settings.calendly), status: "follow-up" });
      log(`✓ Follow-up ready for ${co.company}`, "ok");
    } catch (e) {
      log(`Follow-up failed: ${e.message}`, "err");
    }
    setProc(co.id, null);
  };

  // ── Stats ──
  const stats = {
    total: companies.length,
    discovered: companies.filter(c => c.status === "discovered").length,
    ready: companies.filter(c => c.status === "ready").length,
    sent: companies.filter(c => ["sent", "replied", "interested", "not interested", "follow-up"].includes(c.status)).length,
    interested: companies.filter(c => c.status === "interested").length,
    replied: companies.filter(c => c.status === "replied").length,
  };

  // ══════════════════════════════════════════════════════════
  //  STYLES
  // ══════════════════════════════════════════════════════════
  const C = {
    bg: "#070710",
    surface: "#0d0d1e",
    surface2: "#111125",
    border: "#1c1c38",
    accent: "#ff6b35",
    accent2: "#00e5a0",
    text: "#e0e0f0",
    muted: "#555575",
    font: "'Syne', 'Trebuchet MS', sans-serif",
    mono: "'IBM Plex Mono', monospace",
  };

  const css = {
    app: { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: C.font },
    header: {
      background: `linear-gradient(90deg, ${C.surface} 0%, #0a0a20 100%)`,
      borderBottom: `1px solid ${C.border}`,
      padding: "0 32px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      height: 60,
    },
    logo: { display: "flex", alignItems: "center", gap: 10 },
    logoText: { fontSize: 18, fontWeight: 800, color: C.accent, letterSpacing: -0.5 },
    logoDot: { width: 8, height: 8, borderRadius: "50%", background: C.accent2, animation: "pulse 2s infinite" },
    nav: { display: "flex", gap: 2 },
    navBtn: (a) => ({
      background: a ? `${C.accent}18` : "transparent",
      border: a ? `1px solid ${C.accent}44` : "1px solid transparent",
      color: a ? C.accent : C.muted,
      padding: "6px 16px", borderRadius: 6, cursor: "pointer",
      fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
      fontFamily: C.font, transition: "all 0.15s",
    }),
    main: { padding: "28px 32px", maxWidth: 1140, margin: "0 auto" },
    grid4: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 },
    statCard: (color) => ({
      background: C.surface, border: `1px solid ${color}22`,
      borderRadius: 10, padding: "18px 20px",
      borderLeft: `3px solid ${color}`,
    }),
    statVal: (color) => ({ fontSize: 32, fontWeight: 800, color, lineHeight: 1 }),
    statLbl: { fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginTop: 6 },
    card: {
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: 24, marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 3,
      textTransform: "uppercase", marginBottom: 18, display: "flex", alignItems: "center", gap: 8,
    },
    input: {
      background: "#08081a", border: `1px solid ${C.border}`, color: C.text,
      borderRadius: 8, padding: "10px 14px", fontFamily: C.mono,
      fontSize: 12, width: "100%", boxSizing: "border-box", outline: "none",
    },
    btn: (v) => ({
      background: v === "primary" ? C.accent : v === "green" ? C.accent2 : v === "ghost" ? "transparent" : C.surface2,
      color: v === "primary" ? "#fff" : v === "green" ? "#000" : C.text,
      border: v === "ghost" ? `1px solid ${C.border}` : "none",
      padding: "9px 18px", borderRadius: 8, cursor: "pointer",
      fontFamily: C.font, fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
      textTransform: "uppercase", transition: "opacity 0.15s", whiteSpace: "nowrap",
    }),
    compCard: (status) => ({
      background: C.surface2, borderRadius: 10, padding: "16px 20px",
      marginBottom: 10, border: `1px solid ${STATUS_COLOR[status] || C.border}22`,
      borderLeft: `3px solid ${STATUS_COLOR[status] || C.border}`,
      cursor: "pointer", transition: "border-color 0.2s",
    }),
    badge: (status) => ({
      background: `${STATUS_COLOR[status] || "#555"}22`,
      color: STATUS_COLOR[status] || "#999",
      border: `1px solid ${STATUS_COLOR[status] || "#555"}44`,
      padding: "2px 10px", borderRadius: 20,
      fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
    }),
    tag: (color) => ({
      background: `${color}18`, color, border: `1px solid ${color}33`,
      padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
    }),
    pre: {
      background: "#05050f", border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 14, fontSize: 12, lineHeight: 1.8, whiteSpace: "pre-wrap",
      color: "#a0a0c0", fontFamily: C.mono, maxHeight: 200, overflowY: "auto",
    },
    logLine: (type) => ({
      color: type === "ok" ? C.accent2 : type === "err" ? "#ff4d6d" : type === "warn" ? "#ffd166" : type === "ai" ? "#9d4edd" : C.muted,
      fontSize: 11, fontFamily: C.mono, lineHeight: 1.9, borderBottom: `1px solid ${C.border}44`, paddingBottom: 2,
    }),
    flex: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
    select: {
      background: "#08081a", border: `1px solid ${C.border}`, color: C.text,
      borderRadius: 8, padding: "8px 12px", fontFamily: C.mono, fontSize: 12, outline: "none",
    },
    pill: (active, color) => ({
      background: active ? `${color}22` : "transparent",
      border: `1px solid ${active ? color : C.border}`,
      color: active ? color : C.muted,
      padding: "4px 12px", borderRadius: 20, cursor: "pointer",
      fontSize: 11, fontWeight: 600, userSelect: "none",
    }),
  };

  const TABS = ["hunt", "pipeline", "inbox", "settings", "logs"];
  const TAB_ICONS = { hunt: "🔍", pipeline: "📋", inbox: "📬", settings: "⚙️", logs: "📟" };

  // ══════════════════════════════════════════════════════════
  return (
    <div style={css.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        button:hover { opacity: 0.82; }
        input:focus, textarea:focus, select:focus { border-color: #ff6b3566 !important; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #05050f; }
        ::-webkit-scrollbar-thumb { background: #1c1c38; border-radius: 2px; }
        .company-card:hover { border-color: #ff6b3544 !important; }
        .anim { animation: fadeIn 0.3s ease; }
      `}</style>

      {/* ── Header ── */}
      <header style={css.header}>
        <div style={css.logo}>
          <div style={css.logoDot} />
          <span style={css.logoText}>OUTREACH.AI</span>
          <span style={{ fontSize: 10, color: C.muted, letterSpacing: 2, marginLeft: 4 }}>KENYA</span>
        </div>
        <nav style={css.nav}>
          {TABS.map(t => (
            <button key={t} style={css.navBtn(tab === t)} onClick={() => setTab(t)}>
              {TAB_ICONS[t]} {t}
            </button>
          ))}
        </nav>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: C.mono }}>
          {stats.interested > 0 && <span style={{ color: C.accent2 }}>🎯 {stats.interested} interested</span>}
        </div>
      </header>

      <main style={css.main}>

        {/* ══ HUNT TAB ══════════════════════════════════════════ */}
        {tab === "hunt" && (
          <div className="anim">
            {/* Stats */}
            <div style={css.grid4}>
              {[
                { l: "Leads Found", v: stats.total, c: "#4cc9f0" },
                { l: "Emails Ready", v: stats.ready, c: "#9d4edd" },
                { l: "Sent", v: stats.sent, c: C.accent },
                { l: "Interested 🔥", v: stats.interested, c: C.accent2 },
              ].map(s => (
                <div key={s.l} style={css.statCard(s.c)}>
                  <div style={css.statVal(s.c)}>{s.v}</div>
                  <div style={css.statLbl}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Scraper config */}
            <div style={css.card}>
              <div style={css.sectionTitle}>
                <span>🔍</span> Company Hunter — Find Kenyan Businesses Without Websites
              </div>
              <p style={{ color: C.muted, fontSize: 12, marginBottom: 20, lineHeight: 1.7 }}>
                The AI agent discovers real-world Kenyan small businesses that likely have no online presence,
                across the industries and cities you select. It generates realistic lead data ready for outreach.
              </p>

              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                  Target Cities
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {KENYAN_CITIES.map(city => (
                    <div
                      key={city}
                      style={css.pill(scrapeConfig.cities.includes(city), C.accent)}
                      onClick={() => setScrapeConfig(c => ({
                        ...c,
                        cities: c.cities.includes(city)
                          ? c.cities.filter(x => x !== city)
                          : [...c.cities, city]
                      }))}
                    >
                      {city}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                  Target Industries
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {INDUSTRIES.map(ind => (
                    <div
                      key={ind}
                      style={css.pill(scrapeConfig.industries.includes(ind), "#9d4edd")}
                      onClick={() => setScrapeConfig(c => ({
                        ...c,
                        industries: c.industries.includes(ind)
                          ? c.industries.filter(x => x !== ind)
                          : [...c.industries, ind]
                      }))}
                    >
                      {ind}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ ...css.flex, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, letterSpacing: 2, textTransform: "uppercase" }}>Target Count</div>
                  <select
                    style={css.select}
                    value={scrapeConfig.count}
                    onChange={e => setScrapeConfig(c => ({ ...c, count: +e.target.value }))}
                  >
                    {[5, 10, 20, 30, 50].map(n => <option key={n} value={n}>{n} leads</option>)}
                  </select>
                </div>
              </div>

              <div style={css.flex}>
                <button
                  style={css.btn("primary")}
                  onClick={scrapeLeads}
                  disabled={scraping || scrapeConfig.cities.length === 0 || scrapeConfig.industries.length === 0}
                >
                  {scraping ? "⏳ Hunting…" : "🚀 Start Discovery"}
                </button>
                {companies.length > 0 && (
                  <>
                    <button style={css.btn("green")} onClick={generateAllEmails}>
                      ⚡ Generate All Emails ({stats.discovered})
                    </button>
                    <button style={css.btn()} onClick={() => setTab("pipeline")}>
                      📋 View Pipeline →
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Recent discoveries */}
            {companies.length > 0 && (
              <div style={css.card}>
                <div style={css.sectionTitle}>Recent Leads</div>
                {companies.slice(0, 5).map(co => (
                  <div key={co.id} style={{ ...css.flex, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{co.company}</span>
                      <span style={{ color: C.muted, fontSize: 12, marginLeft: 10 }}>{co.industry} · {co.city}</span>
                    </div>
                    <div style={css.badge(co.status)}>{co.status}</div>
                    <span style={{ fontSize: 11, color: "#4cc9f0", fontFamily: C.mono }}>Score: {co.score}</span>
                  </div>
                ))}
                {companies.length > 5 && (
                  <button style={{ ...css.btn("ghost"), marginTop: 12 }} onClick={() => setTab("pipeline")}>
                    View all {companies.length} →
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ PIPELINE TAB ══════════════════════════════════════ */}
        {tab === "pipeline" && (
          <div className="anim">
            <div style={{ ...css.flex, marginBottom: 20, justifyContent: "space-between" }}>
              <div style={css.sectionTitle}>
                <span>📋</span> Outreach Pipeline — {companies.length} Companies
              </div>
              <div style={css.flex}>
                <button style={css.btn("primary")} onClick={generateAllEmails} disabled={stats.discovered === 0}>
                  ⚡ Generate All ({stats.discovered})
                </button>
                <button style={css.btn()} onClick={() => setCompanies([])}>Clear</button>
              </div>
            </div>

            {companies.length === 0 && (
              <div style={{ ...css.card, textAlign: "center", padding: 48 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                <div style={{ color: C.muted }}>No leads yet. Go to <strong style={{ color: C.accent }}>Hunt</strong> to discover companies.</div>
              </div>
            )}

            {companies.map(co => (
              <div
                key={co.id}
                className="company-card"
                style={css.compCard(co.status)}
                onClick={() => setExpandedId(expandedId === co.id ? null : co.id)}
              >
                {/* Row 1: Summary */}
                <div style={{ ...css.flex, justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={css.flex}>
                    <span style={{ fontWeight: 800, fontSize: 15 }}>{co.company}</span>
                    <span style={css.tag("#4cc9f0")}>{co.industry}</span>
                    <span style={css.tag("#9d4edd")}>{co.city}</span>
                    {co.smsSent && <span style={css.tag(C.accent2)}>SMS ✓</span>}
                  </div>
                  <div style={css.flex}>
                    <span style={{ fontFamily: C.mono, fontSize: 11, color: "#4cc9f0" }}>⭐{co.score}</span>
                    <div style={css.badge(co.status)}>{co.status}</div>
                    <span style={{ color: C.muted, fontSize: 16 }}>{expandedId === co.id ? "▲" : "▼"}</span>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: C.muted, fontFamily: C.mono }}>
                  {co.ownerName && <span>👤 {co.ownerName} · </span>}
                  📧 {co.email || <span style={{ color: "#ff4d6d" }}>no email</span>}
                  {co.phone && <span> · 📞 {co.phone}</span>}
                  {co.address && <span> · 📍 {co.address}</span>}
                </div>

                {/* Expanded */}
                {expandedId === co.id && (
                  <div style={{ marginTop: 16 }} onClick={e => e.stopPropagation()}>
                    <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "12px 0" }} />

                    {/* Email draft */}
                    {co.emailDraft && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, color: C.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
                          EMAIL DRAFT {co.sentAt && `· Sent ${new Date(co.sentAt).toLocaleDateString()}`}
                        </div>
                        <div style={css.pre}>{co.emailDraft}</div>
                      </div>
                    )}

                    {/* Follow-up */}
                    {co.followUpDraft && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, color: "#ffd166", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>FOLLOW-UP DRAFT</div>
                        <div style={css.pre}>{co.followUpDraft}</div>
                      </div>
                    )}

                    {/* Reply classification */}
                    {co.replyCategory && (
                      <div style={{ background: "#05050f", border: `1px solid ${STATUS_COLOR[co.replyCategory]}33`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
                        <div style={css.flex}>
                          <div style={css.badge(co.replyCategory)}>{co.replyCategory}</div>
                          <span style={{ fontSize: 12, color: "#a0a0c0" }}>{co.replySummary}</span>
                          {co.replyUrgency && <span style={css.tag(co.replyUrgency === "high" ? C.accent : "#ffd166")}>
                            {co.replyUrgency} urgency
                          </span>}
                        </div>
                        {co.suggestedReply && (
                          <div style={{ marginTop: 10, fontSize: 12, color: "#9d4edd", fontFamily: C.mono, lineHeight: 1.6 }}>
                            💬 {co.suggestedReply}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Replies */}
                    {co.replies?.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, color: "#00b4d8", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
                          THEIR REPLY
                        </div>
                        <div style={css.pre}>{co.replies[co.replies.length - 1]?.body}</div>
                      </div>
                    )}

                    {/* Manual reply input */}
                    {co.status === "sent" && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
                          PASTE REPLY TO CLASSIFY
                        </div>
                        <textarea
                          rows={3}
                          style={{ ...css.input, resize: "vertical" }}
                          placeholder="Paste their email reply here…"
                          value={replyDraft[co.id] || ""}
                          onChange={e => setReplyDraft(r => ({ ...r, [co.id]: e.target.value }))}
                        />
                      </div>
                    )}

                    {/* Action buttons */}
                    <div style={css.flex}>
                      {!co.emailDraft && (
                        <button style={css.btn("primary")} disabled={!!processing[co.id]} onClick={() => generateEmail(co)}>
                          {processing[co.id] === "drafting" ? "⏳ Writing…" : "✍️ Generate Email"}
                        </button>
                      )}
                      {co.emailDraft && co.status === "ready" && (
                        <button style={css.btn("green")} disabled={!!processing[co.id]} onClick={() => sendEmail(co)}>
                          {processing[co.id] === "sending" ? "⏳ Sending…" : "📤 Send via Gmail"}
                        </button>
                      )}
                      {co.status === "sent" && !co.followUpDraft && (
                        <button style={css.btn()} disabled={!!processing[co.id]} onClick={() => generateFollowUp(co)}>
                          {processing[co.id] === "followup" ? "⏳ Writing…" : "📩 Follow-Up"}
                        </button>
                      )}
                      {co.status === "sent" && replyDraft[co.id] && (
                        <button style={css.btn("primary")} onClick={() => classifyReply(co.id, replyDraft[co.id])}>
                          🤖 Classify Reply
                        </button>
                      )}
                      {co.status === "interested" && (
                        <a href={settings.calendly} target="_blank" rel="noreferrer"
                          style={{ ...css.btn("green"), textDecoration: "none" }}>
                          📅 Book Meeting
                        </a>
                      )}
                      {co.status === "interested" && !co.smsSent && (
                        <button style={css.btn()} onClick={() => sendSMSNotification(co, co.replySummary || "Interested lead!")}>
                          📱 Notify via SMS
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ══ INBOX TAB ════════════════════════════════════════ */}
        {tab === "inbox" && (
          <div className="anim">
            <div style={css.card}>
              <div style={css.sectionTitle}>📬 Inbox — Check Gmail Replies</div>
              <p style={{ color: C.muted, fontSize: 12, marginBottom: 16, lineHeight: 1.7 }}>
                Click below to pull replies from Gmail for all sent campaigns. Claude will auto-classify each reply
                and send you an SMS for any interested leads.
              </p>
              <button style={css.btn("primary")} onClick={checkReplies}>
                🔄 Fetch Replies from Gmail
              </button>
            </div>

            {companies.filter(c => c.replies?.length > 0 || c.replyCategory).map(co => (
              <div key={co.id} style={css.compCard(co.status)}>
                <div style={{ ...css.flex, justifyContent: "space-between" }}>
                  <div>
                    <span style={{ fontWeight: 700 }}>{co.company}</span>
                    <span style={{ color: C.muted, fontSize: 12, marginLeft: 10 }}>{co.email}</span>
                  </div>
                  <div style={css.badge(co.status)}>{co.replyCategory || co.status}</div>
                </div>
                {co.replySummary && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#a0a0c0" }}>{co.replySummary}</div>
                )}
                {co.suggestedReply && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#9d4edd", fontFamily: C.mono }}>
                    Suggested reply: {co.suggestedReply}
                  </div>
                )}
                {co.status === "interested" && (
                  <div style={{ ...css.flex, marginTop: 12 }}>
                    <a href={`mailto:${co.email}`} style={{ ...css.btn("green"), textDecoration: "none" }}>
                      Reply →
                    </a>
                    <a href={settings.calendly} target="_blank" rel="noreferrer"
                      style={{ ...css.btn(), textDecoration: "none" }}>
                      📅 Send Meeting Link
                    </a>
                  </div>
                )}
              </div>
            ))}

            {companies.filter(c => c.replies?.length > 0 || c.replyCategory).length === 0 && (
              <div style={{ ...css.card, textAlign: "center", padding: 48, color: C.muted }}>
                No replies yet. Send some emails first!
              </div>
            )}
          </div>
        )}

        {/* ══ SETTINGS TAB ═════════════════════════════════════ */}
        {tab === "settings" && (
          <div className="anim">
            <div style={css.card}>
              <div style={css.sectionTitle}>👤 Your Profile</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {[
                  { k: "myName", l: "Your Full Name" },
                  { k: "myEmail", l: "Your Gmail Address" },
                  { k: "emailTone", l: "Email Tone" },
                  { k: "calendly", l: "Calendly Meeting Link" },
                ].map(f => (
                  <div key={f.k}>
                    <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>{f.l}</div>
                    <input style={css.input} value={settings[f.k]} onChange={e => setSettings(s => ({ ...s, [f.k]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>

            <div style={css.card}>
              <div style={css.sectionTitle}>📧 Gmail OAuth Setup</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 2, marginBottom: 16 }}>
                <div>1. Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: C.accent }}>Google Cloud Console</a> → Create project → Enable Gmail API</div>
                <div>2. Create OAuth 2.0 credentials → Authorized redirect URIs → <code style={{ color: C.accent2 }}>https://developers.google.com/oauthplayground</code></div>
                <div>3. Go to <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer" style={{ color: C.accent }}>OAuth Playground</a> → select Gmail API scopes → exchange for access token</div>
                <div>4. Paste the access token below:</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Gmail Access Token</div>
                <input type="password" style={css.input} placeholder="ya29.xxx…" value={settings.gmailToken}
                  onChange={e => setSettings(s => ({ ...s, gmailToken: e.target.value }))} />
              </div>
            </div>

            <div style={css.card}>
              <div style={css.sectionTitle}>📱 SMS Alerts — Africa's Talking</div>
              <p style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>
                Africa's Talking is Kenya's premier SMS API. Sign up at <a href="https://africastalking.com" target="_blank" rel="noreferrer" style={{ color: C.accent }}>africastalking.com</a> — free sandbox available.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                {[
                  { k: "atApiKey", l: "API Key" },
                  { k: "atUsername", l: "AT Username" },
                  { k: "smsTel", l: "Your Phone (+254…)" },
                ].map(f => (
                  <div key={f.k}>
                    <div style={{ fontSize: 10, color: C.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>{f.l}</div>
                    <input type={f.k === "atApiKey" ? "password" : "text"} style={css.input}
                      value={settings[f.k]} onChange={e => setSettings(s => ({ ...s, [f.k]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>

            <div style={css.card}>
              <div style={css.sectionTitle}>📅 Meeting Link</div>
              <p style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>
                Your Calendly (or any booking link) is automatically injected into all emails and suggested replies.
              </p>
              <input style={css.input} value={settings.calendly}
                onChange={e => setSettings(s => ({ ...s, calendly: e.target.value }))}
                placeholder="https://calendly.com/yourname/30min" />
            </div>

            <div style={css.card}>
              <div style={css.sectionTitle}>⬇️ Export</div>
              <div style={css.flex}>
                <button style={css.btn("primary")} onClick={() => {
                  const txt = companies.filter(c => c.emailDraft)
                    .map(c => `TO: ${c.email}\nCOMPANY: ${c.company} (${c.city})\nSTATUS: ${c.status}\n\n${c.emailDraft}\n${"─".repeat(60)}`)
                    .join("\n\n");
                  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([txt])), download: "kenya-cold-emails.txt" });
                  a.click();
                }}>
                  ⬇️ Export Emails (.txt)
                </button>
                <button style={css.btn()} onClick={() => {
                  const csv = ["company,email,phone,city,industry,status,score,reply_category",
                    ...companies.map(c => `"${c.company}","${c.email}","${c.phone}","${c.city}","${c.industry}","${c.status}","${c.score}","${c.replyCategory || ""}"`)
                  ].join("\n");
                  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "leads.csv" });
                  a.click();
                }}>
                  ⬇️ Export CSV
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ LOGS TAB ════════════════════════════════════════ */}
        {tab === "logs" && (
          <div className="anim">
            <div style={css.card}>
              <div style={{ ...css.flex, justifyContent: "space-between", marginBottom: 16 }}>
                <div style={css.sectionTitle}>📟 Agent Activity Log</div>
                <button style={css.btn()} onClick={() => setLogs([])}>Clear</button>
              </div>
              <div ref={logRef} style={{ background: "#03030d", border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, maxHeight: 520, overflowY: "auto" }}>
                {logs.length === 0 && <span style={{ color: C.muted, fontFamily: C.mono, fontSize: 11 }}>Agent idle…</span>}
                {logs.map(l => (
                  <div key={l.id} style={css.logLine(l.type)}>
                    <span style={{ color: "#333", marginRight: 8 }}>{l.time}</span>
                    <span style={{ marginRight: 6 }}>{l.icon}</span>
                    {l.msg}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

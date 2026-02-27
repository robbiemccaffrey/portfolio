import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import bcrypt from "bcrypt";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const PORT = Number.parseInt(process.env.PORT || "4091", 10);
const DATA_FILE = process.env.NEWSLETTER_DB_PATH || "/data/portfolio-newsletter.json";
const SITE_URL = process.env.SITE_URL || "https://robertmccaffrey.ie";
const NEWSLETTER_FROM_EMAIL = process.env.NEWSLETTER_FROM_EMAIL || "updates@robertmccaffrey.ie";
const AWS_REGION = process.env.AWS_REGION || "eu-west-1";
const ses = new SESClient({ region: AWS_REGION });
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "https://robertmccaffrey.ie,https://www.robertmccaffrey.ie,https://admin.robertmccaffrey.ie")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const COOKIE_NAME = "portfolio_admin_session";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-IP)
// ---------------------------------------------------------------------------
const rateLimitMap = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entries] of rateLimitMap) {
    const valid = entries.filter((ts) => now - ts < 24 * 60 * 60 * 1000);
    if (valid.length === 0) {
      rateLimitMap.delete(key);
    } else {
      rateLimitMap.set(key, valid);
    }
  }
}, 10 * 60 * 1000);

function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const entries = (rateLimitMap.get(key) || []).filter((ts) => now - ts < windowMs);
  if (entries.length >= maxRequests) {
    return false;
  }
  entries.push(now);
  rateLimitMap.set(key, entries);
  return true;
}

function getClientIp(req) {
  return req.headers["x-real-ip"] || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------------------
// Signed unsubscribe tokens
// ---------------------------------------------------------------------------
function signUnsubscribeToken(email) {
  const sig = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(email).digest("hex");
  return `${Buffer.from(email).toString("base64url")}.${sig}`;
}

function verifyUnsubscribeToken(token) {
  if (!token || !token.includes(".")) return null;
  const [encodedEmail, sig] = token.split(".");
  let email;
  try {
    email = Buffer.from(encodedEmail, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(email).digest("hex");
  if (!safeEqual(expected, sig)) return null;
  return email;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function getOrigin(req) {
  return req.headers.origin || "";
}

function corsHeaders(req) {
  const origin = getOrigin(req);
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function normalizeEmail(input) {
  return String(input || "").trim().toLowerCase();
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((acc, pair) => {
    const [rawKey, ...rest] = pair.split("=");
    if (!rawKey) {
      return acc;
    }
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function b64urlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function b64urlDecode(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function safeEqual(a, b) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function signSession(payload) {
  const encodedPayload = b64urlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifySession(token) {
  if (!token || !token.includes(".")) {
    return null;
  }
  const [encodedPayload, providedSignature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", ADMIN_SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  if (!safeEqual(expectedSignature, providedSignature || "")) {
    return null;
  }
  try {
    const parsed = JSON.parse(b64urlDecode(encodedPayload));
    if (typeof parsed?.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (parsed.username !== ADMIN_USERNAME) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function readBody(req, limitBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function ensureDataFile() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ subscribers: [] }, null, 2), "utf8");
  }
}

async function readDb() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw || "{}");
  return {
    subscribers: Array.isArray(parsed.subscribers) ? parsed.subscribers : [],
  };
}

async function writeDb(db) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

function buildEmailTemplate({ title, summary, blogUrl, previewText, unsubscribeUrl }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
            <tr>
              <td style="padding:18px 24px;background:#f9fafb;border-bottom:1px solid #e5e7eb;text-align:center;">
                <a href="${SITE_URL}/blog" style="font-size:12px;color:#6b7280;text-decoration:none;margin:0 6px;">View Blog</a>
                <span style="color:#d1d5db;">|</span>
                <a href="${SITE_URL}" style="font-size:12px;color:#6b7280;text-decoration:none;margin:0 6px;">Website</a>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 12px 24px;text-align:center;">
                <div style="font-size:28px;font-weight:700;letter-spacing:2px;color:#2563eb;">RM</div>
                <p style="margin:8px 0 0 0;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6b7280;">Robert McCaffrey Newsletter</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 24px 8px 24px;">
                <h1 style="margin:0;font-size:30px;line-height:1.2;color:#111827;">${title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 24px 12px 24px;">
                <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">${summary}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 24px 24px;">
                <a href="${blogUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px;">Read the post</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px 24px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">
                  ${previewText}
                </p>
                <p style="margin:8px 0 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
                  <a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendBlogEmail({ subscribers, title, slug, summary, previewText }) {
  const cleanSlug = String(slug || "").replace(/^\/+|\/+$/g, "");
  const blogUrl = `${SITE_URL}/blog/${cleanSlug}`;
  const results = [];

  for (const subscriber of subscribers) {
    const token = signUnsubscribeToken(subscriber.email);
    const unsubscribeUrl = `${SITE_URL}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
    const htmlBody = buildEmailTemplate({
      title,
      summary,
      blogUrl,
      previewText,
      unsubscribeUrl,
    });
    const textBody = `${title}\n\n${summary}\n\nRead: ${blogUrl}\n\nUnsubscribe: ${unsubscribeUrl}`;

    try {
      const result = await ses.send(
        new SendEmailCommand({
          Source: NEWSLETTER_FROM_EMAIL,
          Destination: { ToAddresses: [subscriber.email] },
          Message: {
            Subject: { Data: `${title} | Robert McCaffrey`, Charset: "UTF-8" },
            Body: {
              Html: { Data: htmlBody, Charset: "UTF-8" },
              Text: { Data: textBody, Charset: "UTF-8" },
            },
          },
        }),
      );
      results.push({ email: subscriber.email, status: "sent", messageId: result.MessageId });
    } catch (err) {
      console.error(`[portfolio-api] SES send failed for ${subscriber.email}:`, err.message);
      results.push({ email: subscriber.email, status: "failed", error: err.message });
    }
  }

  return results;
}

function requireAdmin(req) {
  if (!ADMIN_PASSWORD_HASH || !ADMIN_SESSION_SECRET) {
    return { ok: false, status: 500, error: "Admin auth is not configured." };
  }
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  const session = verifySession(token);
  if (!session) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true, session };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const headers = corsHeaders(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && requestUrl.pathname === "/api/health") {
      json(res, 200, { ok: true }, headers);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/newsletter/subscribe") {
      const ip = getClientIp(req);
      if (!checkRateLimit(`subscribe:${ip}`, 10, 24 * 60 * 60 * 1000)) {
        json(res, 429, { error: "Too many requests. Please try again later." }, headers);
        return;
      }

      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      if (!EMAIL_REGEX.test(email)) {
        json(res, 400, { error: "Enter a valid email address." }, headers);
        return;
      }

      const db = await readDb();
      const existing = db.subscribers.find((entry) => entry.email === email);
      if (existing) {
        existing.status = "active";
        existing.updatedAt = new Date().toISOString();
      } else {
        db.subscribers.push({
          email,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      await writeDb(db);
      json(res, 200, { ok: true, message: "You are subscribed." }, headers);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/newsletter/unsubscribe") {
      const body = await readBody(req);

      // Support signed token-based unsubscribe
      let email;
      if (body.token) {
        email = verifyUnsubscribeToken(body.token);
        if (!email) {
          json(res, 400, { error: "Invalid or expired unsubscribe link." }, headers);
          return;
        }
      } else {
        // Backwards-compatible email-based fallback
        email = normalizeEmail(body.email);
        if (!EMAIL_REGEX.test(email)) {
          json(res, 400, { error: "Enter a valid email address." }, headers);
          return;
        }
      }

      const db = await readDb();
      const existing = db.subscribers.find((entry) => entry.email === email);
      if (existing) {
        existing.status = "unsubscribed";
        existing.updatedAt = new Date().toISOString();
        await writeDb(db);
      }
      json(res, 200, { ok: true, message: "You have been unsubscribed." }, headers);
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/login") {
      if (!ADMIN_PASSWORD_HASH || !ADMIN_SESSION_SECRET) {
        json(res, 500, { error: "Admin auth is not configured." }, headers);
        return;
      }

      const ip = getClientIp(req);
      if (!checkRateLimit(`login:${ip}`, 5, 60 * 60 * 1000)) {
        json(res, 429, { error: "Too many login attempts. Please try again later." }, headers);
        return;
      }

      const body = await readBody(req);
      const username = String(body.username || "");
      const password = String(body.password || "");

      if (!safeEqual(username, ADMIN_USERNAME)) {
        json(res, 401, { error: "Invalid credentials." }, headers);
        return;
      }

      const passwordValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
      if (!passwordValid) {
        json(res, 401, { error: "Invalid credentials." }, headers);
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const token = signSession({ username, exp: now + SESSION_TTL_SECONDS });
      const cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=Lax; Secure`;

      json(res, 200, { ok: true }, { ...headers, "Set-Cookie": cookie });
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/logout") {
      const cookie = `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`;
      json(res, 200, { ok: true }, { ...headers, "Set-Cookie": cookie });
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/admin/subscribers") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.status, { error: auth.error }, headers);
        return;
      }
      const db = await readDb();
      const subscribers = db.subscribers
        .filter((entry) => entry.status === "active")
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      json(
        res,
        200,
        {
          ok: true,
          count: subscribers.length,
          subscribers,
        },
        headers,
      );
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/admin/send-blog") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        json(res, auth.status, { error: auth.error }, headers);
        return;
      }

      const body = await readBody(req);
      const title = String(body.title || "").trim();
      const slug = String(body.slug || "").trim();
      const summary = String(body.summary || "").trim();
      const previewText = String(body.previewText || "You are receiving this because you subscribed for new blog posts.");

      if (!title || !slug || !summary) {
        json(res, 400, { error: "title, slug, and summary are required." }, headers);
        return;
      }

      const db = await readDb();
      const activeSubscribers = db.subscribers.filter((entry) => entry.status === "active");
      if (activeSubscribers.length === 0) {
        json(res, 400, { error: "No active subscribers to send to." }, headers);
        return;
      }

      const result = await sendBlogEmail({
        subscribers: activeSubscribers,
        title,
        slug,
        summary,
        previewText,
      });

      json(
        res,
        200,
        {
          ok: true,
          attempted: activeSubscribers.length,
          result,
        },
        headers,
      );
      return;
    }

    json(res, 404, { error: "Not found" }, headers);
  } catch (error) {
    console.error("[portfolio-api] request failed:", error);
    json(res, 500, { error: "Internal server error" }, headers);
  }
});

// ---------------------------------------------------------------------------
// Fail-fast: validate required secrets before starting
// ---------------------------------------------------------------------------
const missing = [];
if (!ADMIN_PASSWORD_HASH) missing.push("ADMIN_PASSWORD_HASH");
if (!ADMIN_SESSION_SECRET) missing.push("ADMIN_SESSION_SECRET");
if (missing.length > 0) {
  console.error(`[portfolio-api] FATAL: missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`[portfolio-api] listening on port ${PORT}`);
});

import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { fetchPage, analyzeHtml } from "../lib/seoCrawler.js";

export const router = Router();

const auditSchema = z.object({
  baseUrl: z.string().url(),
  paths: z.array(z.string()).min(1).max(50),
});

router.post("/api/seo/audits", auth(["marketing.write"]), async (req, res) => {
  const parsed = auditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { baseUrl, paths } = parsed.data;

  const pages = [];
  for (const path of paths) {
    try {
      const { url, html, status } = await fetchPage(baseUrl, path);
      if (status !== 200 || !html) {
        pages.push({ path, url, status, title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0, h1Count: 0, imageCount: 0, imagesMissingAlt: 0, wordCount: 0, issues: [`fetch failed (HTTP ${status})`] });
        continue;
      }
      pages.push({ path, url, status, ...analyzeHtml(html) });
    } catch (err) {
      pages.push({ path, url: null, status: 0, title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0, h1Count: 0, imageCount: 0, imagesMissingAlt: 0, wordCount: 0, issues: [`fetch error: ${err.message}`] });
    }
  }

  const issuesFound = pages.reduce((sum, p) => sum + p.issues.length, 0);
  const auditResult = db.prepare("INSERT INTO seo_audits (base_url, pages_checked, issues_found, run_by_user_id) VALUES (?, ?, ?, ?)")
    .run(baseUrl, pages.length, issuesFound, req.user.id);
  const auditId = Number(auditResult.lastInsertRowid);

  const insertPage = db.prepare(`
    INSERT INTO seo_audit_pages (audit_id, path, status, title, title_length, meta_description, meta_description_length, h1_count, image_count, images_missing_alt, word_count, issues)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of pages) {
    insertPage.run(auditId, p.path, p.status, p.title, p.titleLength, p.metaDescription, p.metaDescriptionLength, p.h1Count, p.imageCount, p.imagesMissingAlt, p.wordCount, JSON.stringify(p.issues));
  }

  res.status(201).json({ id: auditId, baseUrl, pagesChecked: pages.length, issuesFound, pages });
});

router.get("/api/seo/audits", auth(["marketing.read"]), (req, res) => {
  res.json(db.prepare("SELECT * FROM seo_audits ORDER BY run_at DESC LIMIT 50").all());
});

router.get("/api/seo/audits/:id", auth(["marketing.read"]), (req, res) => {
  const audit = db.prepare("SELECT * FROM seo_audits WHERE id = ?").get(req.params.id);
  if (!audit) return res.status(404).json({ error: "audit not found" });
  const pages = db.prepare("SELECT * FROM seo_audit_pages WHERE audit_id = ? ORDER BY id ASC").all(req.params.id)
    .map(p => ({ ...p, issues: JSON.parse(p.issues || "[]") }));
  res.json({ ...audit, pages });
});

// ===== SEO content calendar =====
const contentItemSchema = z.object({
  title: z.string().min(1),
  targetKeyword: z.string().optional(),
  targetUrl: z.string().optional(),
  notes: z.string().optional(),
});

router.get("/api/seo/content-items", auth(["marketing.read"]), (req, res) => {
  res.json(db.prepare("SELECT * FROM seo_content_items ORDER BY updated_at DESC LIMIT 200").all());
});

router.post("/api/seo/content-items", auth(["marketing.write"]), (req, res) => {
  const parsed = contentItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const c = parsed.data;

  const result = db.prepare("INSERT INTO seo_content_items (title, target_keyword, target_url, notes) VALUES (?, ?, ?, ?)")
    .run(c.title, c.targetKeyword || null, c.targetUrl || null, c.notes || null);

  res.status(201).json({ id: Number(result.lastInsertRowid), ...c, status: "idea" });
});

const contentStatusSchema = z.object({ status: z.enum(["idea", "drafting", "review", "published"]) });

router.patch("/api/seo/content-items/:id/status", auth(["marketing.write"]), (req, res) => {
  const parsed = contentStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid status" });
  const item = db.prepare("SELECT id FROM seo_content_items WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "content item not found" });

  db.prepare("UPDATE seo_content_items SET status = ?, updated_at = datetime('now') WHERE id = ?").run(parsed.data.status, req.params.id);
  res.json({ id: Number(req.params.id), status: parsed.data.status });
});

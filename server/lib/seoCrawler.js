/* Zero-dependency SEO auditor — regex-based extraction is enough to detect
 * presence/length of the tags that matter for on-page SEO, without adding an
 * HTML-parser dependency to a codebase that otherwise has none. Fetches the
 * site's own pages (self-hosted, not a blocked third-party host), so this
 * works against both the local dev server and the real deployed domain. */

// A clean URL from the sitemap (e.g. /about) may 404 on a raw static host
// that only serves /about.html — retry with that suffix before giving up.
export const fetchPage = async (baseUrl, path) => {
  const url = new URL(path, baseUrl).toString();
  const res = await fetch(url);
  if (res.status === 404 && !path.endsWith(".html")) {
    const altPath = path.replace(/\/$/, "") + ".html";
    const altUrl = new URL(altPath, baseUrl).toString();
    const altRes = await fetch(altUrl);
    if (altRes.ok) return { url: altUrl, html: await altRes.text(), status: altRes.status };
  }
  return { url, html: res.ok ? await res.text() : "", status: res.status };
};

export const analyzeHtml = (html) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, " ") : null;

  const metaDescMatch =
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
    html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);
  const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : null;

  const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;

  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const imageCount = imgTags.length;
  const imagesMissingAlt = imgTags.filter(tag =>
    !/\balt\s*=\s*["'][^"']*["']/i.test(tag) || /\balt\s*=\s*["']\s*["']/i.test(tag)
  ).length;

  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const wordCount = (textOnly.match(/\b[\w'-]+\b/g) || []).length;

  const issues = [];
  if (!title) issues.push("missing <title>");
  else if (title.length < 30) issues.push("title too short (<30 chars)");
  else if (title.length > 65) issues.push("title too long (>65 chars)");
  if (!metaDescription) issues.push("missing meta description");
  else if (metaDescription.length < 70) issues.push("meta description too short (<70 chars)");
  else if (metaDescription.length > 160) issues.push("meta description too long (>160 chars)");
  if (h1Count === 0) issues.push("no <h1> found");
  else if (h1Count > 1) issues.push(`multiple <h1> tags (${h1Count})`);
  if (imagesMissingAlt > 0) issues.push(`${imagesMissingAlt} image(s) missing alt text`);
  if (wordCount < 150) issues.push("thin content (<150 words)");

  return {
    title, titleLength: title?.length || 0,
    metaDescription, metaDescriptionLength: metaDescription?.length || 0,
    h1Count, imageCount, imagesMissingAlt, wordCount, issues,
  };
};

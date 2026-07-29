import type { SitePage } from "@deedwell/schemas";
import { pageUrl, type RenderedFile } from "./renderer.js";

/**
 * Deterministic SEO & accessibility review of a built release (the reviewer
 * "agent" is rules code — model output never certifies its own quality).
 */

export interface SiteCheck {
  name: string;
  page: string | null;
  pass: boolean;
  detail: string;
}

export function runSiteChecks(files: RenderedFile[], pages: SitePage[]): SiteCheck[] {
  const checks: SiteCheck[] = [];
  const validUrls = new Set([...pages.map((p) => pageUrl(p.slug)), "/thanks/"]);
  const htmlFiles = files.filter((f) => f.contentType.startsWith("text/html"));

  for (const file of htmlFiles) {
    const page = file.path.replace(/index\.html$/, "") || "/";
    const html = file.content;

    checks.push({
      name: "Title tag present",
      page,
      pass: /<title>[^<]{3,}<\/title>/.test(html),
      detail: "Every page needs a descriptive <title>",
    });
    checks.push({
      name: "Meta description present",
      page,
      pass: /<meta name="description" content="[^"]{3,}"/.test(html),
      detail: "Search engines and previews use the description",
    });
    const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
    checks.push({
      name: "Exactly one h1",
      page,
      pass: h1Count === 1,
      detail: h1Count === 1 ? "OK" : `${h1Count} h1 elements found`,
    });
    checks.push({
      name: "Language attribute set",
      page,
      pass: /<html lang="/.test(html),
      detail: "Screen readers need the document language",
    });

    const inputs = [...html.matchAll(/<(?:input|textarea)[^>]*\bid="([^"]+)"/g)].map((m) => m[1]!);
    const labels = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]!));
    const unlabeled = inputs.filter((id) => !labels.has(id));
    checks.push({
      name: "Form inputs labeled",
      page,
      pass: unlabeled.length === 0,
      detail: unlabeled.length ? `Unlabeled inputs: ${unlabeled.join(", ")}` : "All inputs have labels",
    });

    const internalLinks = [...html.matchAll(/href="(\/[^"]*)"/g)]
      .map((m) => m[1]!)
      .filter((href) => !href.startsWith("/forms/") && href !== "/#main" && !href.startsWith("/#"));
    const broken = internalLinks.filter((href) => !validUrls.has(href));
    checks.push({
      name: "Internal links resolve",
      page,
      pass: broken.length === 0,
      detail: broken.length ? `Broken: ${broken.join(", ")}` : "All internal links resolve",
    });
    checks.push({
      name: "No script tags (static template policy)",
      page,
      pass: !/<script/i.test(html),
      detail: "Approved templates ship zero JavaScript",
    });
  }

  const placeholderPages = pages.filter((p) =>
    JSON.stringify(p.blocks).includes("[Placeholder:")
  );
  checks.push({
    name: "No placeholder content remaining",
    page: null,
    pass: placeholderPages.length === 0,
    detail: placeholderPages.length
      ? `Placeholders on: ${placeholderPages.map((p) => p.slug).join(", ")} — fill missing facts before publishing`
      : "No placeholders",
  });
  checks.push({
    name: "Sitemap generated",
    page: null,
    pass: files.some((f) => f.path === "sitemap.xml"),
    detail: "sitemap.xml is part of the release",
  });
  return checks;
}

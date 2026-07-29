import type {
  EligibilityRule,
  EligibilityStatus,
  ExtractedRequirement,
  OrgFact,
  RuleFinding,
} from "@deedwell/schemas";

/**
 * Eligibility engine (BRD §8.1). Deterministic: rules are derived from the
 * announcement's eligibility requirements, then evaluated against the fact
 * ledger. The model extracts text; it NEVER decides eligibility, and missing
 * information is never treated as eligible.
 */

export function deriveEligibilityRules(
  requirements: ExtractedRequirement[],
  deadline: string | null
): EligibilityRule[] {
  const rules: EligibilityRule[] = [];
  for (const req of requirements.filter((r) => r.kind === "eligibility" && r.mandatory)) {
    const line = req.sourceLocation.line;
    const entityMatch = req.text.match(/501\s*\(\s*c\s*\)\s*\(?\s*(\d+)\s*\)?/i);
    if (entityMatch || /nonprofit/i.test(req.text)) {
      rules.push({
        ruleKey: `entity_type_l${line}`,
        kind: "entity_type",
        params: { mustInclude: entityMatch ? `501(c)(${entityMatch[1]})` : "nonprofit" },
        sourceLine: line,
      });
    }
    if (/\bregister|registration|registered\b/i.test(req.text)) {
      rules.push({
        ruleKey: `registration_l${line}`,
        kind: "registration_required",
        params: {},
        sourceLine: line,
      });
    }
    const budgetCap = req.text.match(
      /annual (?:operating )?budget[^$]*\$\s*([\d,]+)|budget (?:under|below|not exceed(?:ing)?)\s*\$\s*([\d,]+)/i
    );
    if (budgetCap) {
      const cap = Number((budgetCap[1] ?? budgetCap[2] ?? "0").replace(/,/g, ""));
      if (cap > 0) {
        rules.push({
          ruleKey: `budget_cap_l${line}`,
          kind: "max_annual_budget",
          params: { maxUsd: cap },
          sourceLine: line,
        });
      }
    }
    const geo = req.text.match(/located in|based in|serving\s+([A-Z][a-zA-Z ]{2,40})/);
    if (geo?.[1]) {
      rules.push({
        ruleKey: `geography_l${line}`,
        kind: "geography",
        params: { area: geo[1].trim() },
        sourceLine: line,
      });
    }
  }
  if (deadline) {
    rules.push({
      ruleKey: "deadline_future",
      kind: "deadline_future",
      params: { deadline },
      sourceLine: null,
    });
  }
  return rules;
}

export interface EligibilityEvaluation {
  overall: EligibilityStatus;
  findings: RuleFinding[];
  missingFacts: string[];
}

const RULE_FACT: Record<string, string | null> = {
  entity_type: "entity_type",
  registration_required: "registration_status",
  geography: "service_area",
  max_annual_budget: "annual_budget",
  deadline_future: null,
};

export function evaluateEligibility(
  rules: EligibilityRule[],
  facts: OrgFact[],
  now = new Date()
): EligibilityEvaluation {
  const ledger = new Map(
    facts
      .filter((f) => f.status === "verified" || f.status === "user_certified")
      .map((f) => [f.key, f])
  );
  const findings: RuleFinding[] = [];
  const missing = new Set<string>();

  for (const rule of rules) {
    const factKey = RULE_FACT[rule.kind] ?? null;
    const fact = factKey ? ledger.get(factKey) : undefined;

    if (rule.kind === "deadline_future") {
      const deadline = new Date(String(rule.params.deadline));
      const pass = deadline.getTime() > now.getTime();
      findings.push({
        ruleKey: rule.ruleKey,
        status: pass ? "pass" : "fail",
        evidence: pass
          ? `Deadline ${rule.params.deadline} is in the future`
          : `Deadline ${rule.params.deadline} has already passed`,
        factKey: null,
      });
      continue;
    }

    if (!fact) {
      if (factKey) missing.add(factKey);
      findings.push({
        ruleKey: rule.ruleKey,
        status: "unknown",
        evidence: `No verified or user-certified fact for "${factKey}"`,
        factKey,
      });
      continue;
    }

    let pass: boolean;
    let evidence: string;
    switch (rule.kind) {
      case "entity_type": {
        const needle = String(rule.params.mustInclude).toLowerCase();
        pass =
          fact.value.toLowerCase().includes(needle) ||
          (needle === "nonprofit" && /501\s*\(\s*c\s*\)/i.test(fact.value));
        evidence = `Entity type on file: "${fact.value}" (${fact.status})`;
        break;
      }
      case "registration_required":
        pass = !/not registered|unregistered|pending/i.test(fact.value);
        evidence = `Registration status on file: "${fact.value}" (${fact.status})`;
        break;
      case "geography": {
        const area = String(rule.params.area).toLowerCase();
        pass = fact.value.toLowerCase().includes(area);
        evidence = `Service area on file: "${fact.value}" vs required "${rule.params.area}"`;
        break;
      }
      case "max_annual_budget": {
        const amount = Number(fact.value.replace(/[^0-9.]/g, ""));
        const cap = Number(rule.params.maxUsd);
        if (!amount) {
          findings.push({
            ruleKey: rule.ruleKey,
            status: "unknown",
            evidence: `Annual budget "${fact.value}" is not a parseable amount`,
            factKey,
          });
          if (factKey) missing.add(factKey);
          continue;
        }
        pass = amount <= cap;
        evidence = `Annual budget ${fact.value} vs cap $${cap.toLocaleString()}`;
        break;
      }
    }
    findings.push({ ruleKey: rule.ruleKey, status: pass ? "pass" : "fail", evidence, factKey });
  }

  const hasFail = findings.some((f) => f.status === "fail");
  const hasUnknown = findings.some((f) => f.status === "unknown");
  const allVerified = [...ledger.values()].every((f) => f.status === "verified");

  let overall: EligibilityStatus;
  if (hasFail) overall = "ineligible";
  else if (hasUnknown) overall = "insufficient_information";
  else if (rules.length === 0) overall = "insufficient_information";
  else overall = allVerified ? "verified_eligible" : "likely_eligible";

  return { overall, findings, missingFacts: [...missing] };
}

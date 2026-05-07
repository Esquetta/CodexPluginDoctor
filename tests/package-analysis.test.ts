import { describe, expect, it } from "vitest";

import {
  buildPackageAnalysis,
  buildDoctorRecommendationsFromAnalysis,
  buildDoctorExportBundleFromAnalysis
} from "../src/core/package-analysis.js";

describe("shared package analysis", () => {
  it("builds reusable validation, security, compatibility, recommendation, and trust analysis", async () => {
    const analysis = await buildPackageAnalysis("tests/fixtures/security-hardcoded-secret", {
      environment: {
        env: {},
        platform: "win32"
      }
    });
    const recommendations = buildDoctorRecommendationsFromAnalysis(analysis);
    const bundle = buildDoctorExportBundleFromAnalysis(analysis, recommendations);

    expect(analysis.validation.status).toBe("fail");
    expect(analysis.security.status).toBe("fail");
    expect(analysis.trust.status).toBe("fail");
    expect(analysis.compatibility.results.length).toBeGreaterThan(0);
    expect(recommendations.actions[0]).toMatchObject({
      priority: "blocker",
      findingId: "plugin.security.hard_coded_secret"
    });
    expect(bundle.validation.summary.status).toBe("fail");
    expect(bundle.security).toBe(analysis.security);
    expect(bundle.compatibility).toBe(analysis.compatibility);
    expect(bundle.trust).toBe(analysis.trust);
  });
});

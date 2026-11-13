import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile } from "node:fs/promises";

async function selectSeededBaseline(page: Page) {
  await page
    .getByLabel("Research project")
    .selectOption({ label: "Evidence under revision" });
  const evaluation = page.getByLabel("Active evaluation");
  const baseline = evaluation.locator("option").filter({
    hasText: /^first-match \/ development \/ [^/]+ \/ complete$/,
  });
  await expect(baseline).toHaveCount(1);
  await evaluation.selectOption({ label: await baseline.innerText() });
}

test("Complete dataset, evaluation, provenance, correction, comparison and report workflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const projectName = `Browser investigation ${Date.now()}`;
  await page.getByLabel("Project name").fill(projectName);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Datasets", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Cases per family").fill("4");
  await page
    .getByRole("button", { name: "Register benchmark", exact: true })
    .click();
  await expect(
    page
      .getByRole("button", { name: /Evidence revision benchmark \/ / })
      .first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New evaluation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run evaluation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Inspect revision-000 repeat 1" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect revision-000 repeat 1" })
    .click();
  const inspector = page.getByRole("complementary", {
    name: "Evidence inspector",
  });
  await expect(
    inspector.getByText("Contradicted", { exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByText(
      "A source can be reached through recorded derivation links.",
    ),
  ).toBeVisible();
  await inspector
    .getByLabel("Correction rationale")
    .fill("Use the newest revision of the trusted evidence.");
  await inspector
    .getByRole("button", { name: "Submit correction", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Review & correction", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Researcher / reviewer").fill("Browser reviewer");
  await page
    .getByLabel("Review rationale", { exact: true })
    .fill("Accepted after comparing both source revisions.");
  await page
    .getByRole("button", { name: "Record review", exact: true })
    .click();
  await expect(page.getByText("accepted", { exact: true })).toBeVisible();
  const screenshotDir = process.env.NX_SCREENSHOTS || "docs/screenshots";
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({
    path: `${screenshotDir}/review-correction.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Rerun affected case", exact: true })
    .click();
  await expect(page.getByTestId("comparison-result")).toContainText(
    "1 shared cases",
  );
  await expect(page.getByTestId("comparison-result")).toContainText(
    "Partial overlap",
  );
  await expect(page.getByTestId("comparison-result")).toContainText("+100.0");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  const report = await downloadPromise;
  await report.saveAs(
    (process.env.NX_TEST_OUTPUT || "test-results/artifacts") +
      "/browser-report.json",
  );
  const reportPath =
    (process.env.NX_TEST_OUTPUT || "test-results/artifacts") +
    "/browser-report.json";
  const exported = JSON.parse(await readFile(reportPath, "utf8"));
  expect(exported.run.summary.unique_cases).toBe(1);
  expect(exported.run.summary.metrics.accuracy.value).toBe(1);
  expect(exported.corrections).toHaveLength(1);
  await page.screenshot({
    path: `${screenshotDir}/corrected-workflow.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "View report", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    exported.semantic_digest,
  );
  await page.screenshot({
    path: `${screenshotDir}/generated-report.png`,
    fullPage: false,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Save workspace layout" }).click();
  await page.getByLabel("Layout name").fill("Corrected case review");
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(
    page
      .getByLabel("Restore saved workspace")
      .locator("option", { hasText: "Corrected case review" }),
  ).toHaveCount(1);
  await page.reload();
  await page
    .getByLabel("Research project")
    .selectOption({ label: projectName });
  await page
    .getByLabel("Restore saved workspace")
    .selectOption({ label: "Corrected case review" });
  await expect(
    page.getByRole("button", { name: "Inspect revision-000 repeat 1" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Evidence & lineage", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Provenance network", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Verify hashes", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Integrity check complete" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Keyboard filtering and SVG export retain source measurements", async ({
  page,
}) => {
  await page.goto("/");
  await selectSeededBaseline(page);
  const mark = page.getByRole("button", { name: /Filter Revision/ });
  await mark.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Case family", { exact: true })).toHaveValue(
    "revision",
  );
  const section = mark.locator("xpath=ancestor::section[1]");
  const rendered = await section
    .locator("rect[data-value]")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        value: n.getAttribute("data-value"),
        source: n.getAttribute("data-source-id"),
      })),
    );
  expect(rendered.length).toBeGreaterThan(0);
  const downloaded = page.waitForEvent("download");
  await section
    .getByRole("button", { name: "Export SVG", exact: true })
    .click();
  const file = await downloaded;
  const path = await file.path();
  const svg = await readFile(path!, "utf8");
  for (const datum of rendered) {
    expect(svg).toContain(`data-value="${datum.value}"`);
    expect(svg).toContain(`data-source-id="${datum.source}"`);
  }
});

test("Failed server operations remain visible and do not display success", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("Failure control");
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Controlled benchmark failure" }),
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Controlled benchmark failure",
  );
});

test("Linked chart filters, evidence navigation, annotations and version history", async ({
  page,
}) => {
  await page.goto("/");
  await selectSeededBaseline(page);
  await page.getByRole("button", { name: /Filter Revision/ }).click();
  await expect(page.getByLabel("Case family", { exact: true })).toHaveValue(
    "revision",
  );
  await page
    .getByRole("button", { name: "Inspect revision-000 repeat 1" })
    .click();
  const inspector = page.getByRole("complementary", {
    name: "Evidence inspector",
  });
  await inspector.getByText("Add a human annotation", { exact: true }).click();
  await inspector
    .getByLabel("Interpretation", { exact: true })
    .fill("Earlier evidence was selected despite a later revision.");
  await inspector
    .getByRole("button", { name: "Record annotation", exact: true })
    .click();
  await expect(inspector.getByRole("heading", { level: 2 })).toContainText(
    "Note on revision-000",
  );
  await inspector.getByText("Revise annotation", { exact: true }).click();
  await inspector
    .getByLabel("Revised interpretation")
    .fill("Refined interpretation: prefer later trusted revisions.");
  await inspector
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(
    inspector.getByText("Annotation · v2", { exact: true }),
  ).toBeVisible();
  await inspector
    .getByText("Version history", { exact: false })
    .first()
    .click();
  await expect(
    inspector.getByRole("button", { name: /Version 1/ }),
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", { name: /Version 2/ }),
  ).toBeVisible();
});

test("Accessible overview, evaluation, evidence, dataset and review views", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const name of [
    "Research overview",
    "Evaluations",
    "Evidence & lineage",
    "Datasets",
    "Review & correction",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("main h1")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
      name,
    ).toEqual([]);
  }
});

test("Mobile layout and keyboard navigation remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (
    await page
      .getByRole("button", { name: "Hide inspector", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Hide inspector", exact: true })
      .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Datasets", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Register benchmark", exact: true }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("Capture actual interface screenshots", async ({ page }) => {
  const dir = process.env.NX_SCREENSHOTS || "docs/screenshots";
  await mkdir(dir, { recursive: true });
  await page.goto("/");
  await selectSeededBaseline(page);
  const conflict = page.getByRole("button", {
    name: "Inspect conflict-000 repeat 1",
  });
  await expect(conflict).toBeVisible();
  await conflict.click();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: `${dir}/research-overview.png`,
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Evidence & lineage", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Provenance network", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${dir}/trace-provenance.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/loop-evaluation.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Hide inspector", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Research overview", exact: true })
    .click();
  await page.screenshot({ path: `${dir}/mobile-overview.png`, fullPage: true });
});

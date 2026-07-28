import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function enterDemo(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("enter-demo")).toBeVisible();
  await page.getByTestId("enter-demo").click();
  await expect(page.getByTestId("logout")).toBeVisible();
  await expect(page.getByTestId("create-note")).toBeVisible();
}

async function createSavedNote(page: Page, title: string, content: string): Promise<void> {
  await page.getByTestId("create-note").click();
  await expect(page.getByLabel("Note title")).toHaveValue("Untitled Note");
  await page.getByLabel("Note title").fill(title);
  await page.getByLabel("Note description").fill(content);
  await expect(page.getByTestId("autosave-status")).toHaveText(/Last saved: \d/, {
    timeout: 10_000,
  });
}

async function openSecondClient(page: Page): Promise<{ context: BrowserContext; page: Page }> {
  const browser = page.context().browser();

  if (!browser) {
    throw new Error("The E2E test requires a browser context");
  }

  const context = await browser.newContext({
    storageState: {
      cookies: await page.context().cookies(),
      origins: [],
    },
  });
  const secondPage = await context.newPage();
  const noteUpdatedSubscription = secondPage.waitForResponse(
    (response) => response.url().includes("noteUpdated") && response.status() === 200,
    { timeout: 10_000 }
  );

  await secondPage.goto("/");
  await expect(secondPage.getByTestId("logout")).toBeVisible();
  await expect(secondPage.getByTestId("create-note")).toBeVisible();
  await noteUpdatedSubscription;

  return { context, page: secondPage };
}

test("enters Demo Mode and exposes a ready workspace", async ({ page }) => {
  await enterDemo(page);

  await expect(page.getByText("Temporary workspace")).toBeVisible();
  await expect(page.getByTestId("create-note")).toBeEnabled();
});

test("creates a note and autosaves title and content", async ({ page }) => {
  await enterDemo(page);
  await createSavedNote(page, "Launch roadmap", "launch roadmap");

  await expect(page.getByLabel("Note title")).toHaveValue("Launch roadmap");
  await expect(page.getByLabel("Note description")).toHaveValue("launch roadmap");
});

test("returns semantically matching notes for a search query", async ({ page }) => {
  await enterDemo(page);
  await createSavedNote(page, "Semantic roadmap", "launch roadmap");
  await page.getByRole("button", { name: "Close note and return to board" }).click();

  const searchInput = page.getByRole("textbox", { name: "Search boards and notes" });
  await searchInput.fill("launch roadmap");

  const matchingCard = page.getByTestId("note-card").filter({ hasText: "Semantic roadmap" });
  await expect(matchingCard).toBeVisible({ timeout: 10_000 });
});

test("logs out and returns to the authentication screen", async ({ page }) => {
  await enterDemo(page);
  await page.getByTestId("logout").click();

  await expect(page.getByTestId("enter-demo")).toBeVisible();
  await expect(page.getByTestId("logout")).toHaveCount(0);
});

test("returns to authentication when the session cookie is gone", async ({ page }) => {
  await enterDemo(page);
  await page.context().clearCookies();
  await page.reload();

  await expect(page.getByTestId("enter-demo")).toBeVisible();
  await expect(page.getByTestId("logout")).toHaveCount(0);
});

test("delivers note updates to a second connected client", async ({ page }) => {
  await enterDemo(page);
  const secondClient = await openSecondClient(page);

  try {
    await page.getByTestId("create-note").click();
    await expect(page.getByLabel("Note title")).toHaveValue("Untitled Note");
    await page.getByLabel("Note title").fill("Realtime update");
    await page.getByLabel("Note description").fill("Shared content");

    const updatedCard = secondClient.page
      .getByTestId("note-card")
      .filter({ hasText: "Realtime update" });
    await expect(updatedCard).toBeVisible({ timeout: 10_000 });
  } finally {
    await secondClient.context.close();
  }
});

test("delivers note deletion to a second connected client", async ({ page }) => {
  await enterDemo(page);
  const secondClient = await openSecondClient(page);

  try {
    await createSavedNote(page, "Delete across clients", "Shared content");
    const existingCard = secondClient.page
      .getByTestId("note-card")
      .filter({ hasText: "Delete across clients" });
    await expect(existingCard).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();

    const deletedCard = secondClient.page
      .getByTestId("note-card")
      .filter({ hasText: "Delete across clients" });
    await expect(deletedCard).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await secondClient.context.close();
  }
});
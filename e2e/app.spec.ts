import { expect, test, type Page } from "@playwright/test";

const shots = process.env.SCREENSHOTS === "1";

async function fresh(page: Page) {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.goto("./");
}

async function center(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test("the full adder example has the right truth table", async ({ page }, info) => {
  await fresh(page);
  const table = page.getByRole("table", { name: "Truth table" });
  await expect(table.locator("tbody tr")).toHaveCount(8);
  // row 7: A=B=Cin=1 -> Cout=1, S=1
  await expect(table.locator("tbody tr").nth(7)).toHaveText(/1\s*1\s*1\s*1\s*1/);
  if (shots) await page.screenshot({ path: `docs/screens/circuit-${info.project.name}.png` });
});

test("build a circuit from scratch: place, wire, switch, check", async ({ page, isMobile }) => {
  test.skip(isMobile, "drag-and-drop wiring is covered on desktop");
  await fresh(page);
  await page.getByRole("button", { name: "Clear" }).click();
  const canvas = (await page.locator("svg.editor").boundingBox())!;
  const spot = (x: number, y: number) => ({ x: canvas.x + x, y: canvas.y + y });

  const place = async (name: string, at: { x: number; y: number }) => {
    await page.getByRole("button", { name, exact: true }).click();
    const body = page.locator("[data-comp]").last();
    await drag(page, await center(page, `[data-comp="${await body.getAttribute("data-comp")}"]`), at);
    return (await body.getAttribute("data-comp"))!;
  };
  const a = await place("Switch", spot(80, 100));
  const b = await place("Switch", spot(80, 260));
  const g = await place("XOR", spot(300, 180));
  const f = await place("Light", spot(480, 180));

  const pin = (id: string, dir: string, n: number) => center(page, `[data-pin="${id}|${dir}|${n}"]`);
  await drag(page, await pin(a, "out", 0), await pin(g, "in", 0));
  await drag(page, await pin(b, "out", 0), await pin(g, "in", 1));
  // tap-to-connect: tap the output pin, then the input pin
  await page.mouse.click(...Object.values(await pin(g, "out", 0)) as [number, number]);
  await page.mouse.click(...Object.values(await pin(f, "in", 0)) as [number, number]);
  await expect(page.locator("path.wire")).toHaveCount(3);

  await expect(page.getByText("F = A ⊕ B")).toBeVisible();
  // flip A: the light turns on
  await page.locator(`[data-comp="${a}"]`).click();
  await expect(page.locator(".led.hi")).toHaveCount(1);

  await page.getByRole("tab", { name: "Check" }).click();
  await page.getByLabel("Expected F").fill("A'B + AB'");
  await expect(page.getByText("F matches on all 4 input combinations.")).toBeVisible();
  await page.getByLabel("Expected F").fill("A + B");
  await expect(page.getByText(/Different when A = 1, B = 1: the circuit gives 0, it should be 1/)).toBeVisible();

  // undo removes the last wire change
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("path.wire")).toHaveCount(2);
});

test("SR latch remembers", async ({ page }, info) => {
  await fresh(page);
  await page.getByLabel("Load an example").selectOption("sr-latch");
  const flip = (id: string) => page.locator(`[data-comp="${id}"]`).click();
  const q = page.locator('[data-comp="Q"] .led');
  await expect(q).toHaveClass(/x/); // never set: unknown
  await flip("S");
  await expect(q).toHaveClass(/hi/);
  await flip("S"); // S back to 0: Q holds 1
  await expect(q).toHaveClass(/hi/);
  await flip("R");
  await expect(q).toHaveClass(/lo/);
  await expect(page.getByText("Settled.")).toBeVisible();
  if (shots) await page.screenshot({ path: `docs/screens/latch-${info.project.name}.png` });
});

test("ring oscillator is reported", async ({ page }) => {
  await fresh(page);
  await page.getByLabel("Load an example").selectOption("ring");
  await expect(page.getByText("Settled.")).toBeVisible();
  await page.locator('[data-comp="EN"]').click();
  await expect(page.getByText(/Does not settle/)).toBeVisible();
});

test("counter: ticks, 7-segment display and timing diagram", async ({ page }, info) => {
  await fresh(page);
  await page.getByLabel("Load an example").selectOption("counter");
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Tick" }).click();
  await expect(page.getByText("5 clock cycles")).toBeVisible();
  await expect(page.locator("title", { hasText: "shows 5 (5)" })).toHaveCount(1);
  await page.getByRole("tab", { name: "Timing" }).click();
  await expect(page.getByRole("img", { name: "Timing diagram" })).toBeVisible();
  if (shots) await page.screenshot({ path: `docs/screens/counter-${info.project.name}.png` });
});

test("Boolean algebra: minimise, K-map, build NAND-only circuit", async ({ page }, info) => {
  await fresh(page);
  await page.getByRole("tab", { name: "Boolean algebra" }).click();
  await page.getByLabel("Boolean expression").fill("w'x'y'z' + w'x'y'z + w'x'yz' + w'xy'z' + w'xy'z + w'xyz' + wx'y'z' + wx'y'z + wxy'z' + wxy'z + wxyz'");
  await expect(page.getByText("F = y' + w'z' + xz'")).toBeVisible();
  await expect(page.getByRole("img", { name: "Karnaugh map" })).toBeVisible();
  if (shots) await page.screenshot({ path: `docs/screens/algebra-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "NAND only" }).click();
  await expect(page.getByRole("tab", { name: "Circuit" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".gate")).not.toHaveCount(0);
  const table = page.getByRole("table", { name: "Truth table" });
  await expect(table.locator("tbody tr")).toHaveCount(16);
});

test("truth table editing with don't cares", async ({ page }) => {
  await fresh(page);
  await page.getByRole("tab", { name: "Boolean algebra" }).click();
  await page.getByLabel("Number of variables").selectOption("4");
  await page.getByRole("button", { name: "New table" }).click();
  // Σm(1,3,7,11,15) + d(0,2,5) = A'B' + CD  (Mano's yz + w'x' with A–D for w–z)
  const click = (r: number) => page.getByRole("button", { name: new RegExp(`^Row ${r}: `) }).click();
  for (const r of [1, 3, 7, 11, 15]) await click(r);
  for (const r of [0, 2, 5]) { await click(r); await click(r); }
  await expect(page.getByText("F = Σm(1, 3, 7, 11, 15) + d(0, 2, 5)")).toBeVisible();
  await expect(page.getByText("F = A'B' + CD")).toBeVisible();
  await expect(page.getByText("F = D(A' + C)")).toBeVisible();
});

test("errors in expressions are explained", async ({ page }) => {
  await fresh(page);
  await page.getByRole("tab", { name: "Boolean algebra" }).click();
  await page.getByLabel("Boolean expression").fill("A + (B");
  await expect(page.getByRole("alert")).toContainText('Missing ")"');
});

test("work survives a reload", async ({ page }) => {
  await fresh(page);
  await page.getByLabel("Load an example").selectOption("mux2");
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByText(/Y = /)).toBeVisible();
});

test("no sideways scrolling on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await fresh(page);
  for (const tab of ["Circuit", "Boolean algebra"]) {
    await page.getByRole("tab", { name: tab }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), tab).toBeLessThanOrEqual(1);
  }
});

test("dark mode", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await fresh(page);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(15, 19, 24)");
  if (shots) await page.screenshot({ path: `docs/screens/dark-${info.project.name}.png` });
});

test("touch: select and delete a wire, then reconnect it by tapping two pins", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch run");
  await fresh(page);
  await page.getByLabel("Load an example").selectOption("half-adder");
  await expect(page.locator("path.wire")).toHaveCount(6);
  // the wire from the XOR gate to S
  const hit = page.locator('[data-wire] path.wire-hit').nth(4);
  const box = (await hit.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: "Delete" }).tap();
  await expect(page.locator("path.wire")).toHaveCount(5);
  await expect(page.getByText(/S is not connected/)).toBeVisible();
  const tapPin = async (sel: string) => {
    const b = (await page.locator(sel).boundingBox())!;
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  await tapPin('[data-pin="x|out|0"]');
  await tapPin('[data-pin="S|in|0"]');
  await expect(page.locator("path.wire")).toHaveCount(6);
  await expect(page.getByText("S = A ⊕ B")).toBeVisible();
});

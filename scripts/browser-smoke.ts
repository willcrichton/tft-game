import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4318;
const SHOTS = process.env.SHOTS ?? "dist-shots";
let secret = readFileSync(".admin-passphrase", "utf8").trim();

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css"
};
let server = createServer((req, res) => {
  let path = join("dist", (req.url ?? "/").split("?")[0]);
  if (!existsSync(path) || path.endsWith("/")) path = join(path, "index.html");
  if (!existsSync(path)) path = "dist/index.html";
  res.setHeader(
    "Content-Type",
    TYPES[extname(path)] ?? "application/octet-stream"
  );
  createReadStream(path).pipe(res);
}).listen(PORT);
let base = process.env.BASE_URL ?? `http://localhost:${PORT}/`;

let check = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok  ${msg}`);
};

let browser: Browser = await chromium.launch({ executablePath: CHROME });
let newPage = async (hash = "") => {
  let ctx = await browser.newContext({
    viewport: { width: 1200, height: 860 }
  });
  let page = await ctx.newPage();
  page.on("pageerror", e => console.error("pageerror", e.message));
  await page.goto(base + hash);
  return page;
};

let confirm = async (page: Page, name: string) => {
  let btn = page.getByRole("button", { name });
  await btn.click();
  await page.getByRole("button", { name: "Click again to confirm" }).click();
};

let pages: Page[] = [];
try {
  let admin = await newPage("#admin");
  pages.push(admin);
  await admin.getByPlaceholder("Passphrase").fill("wrong");
  await admin.getByRole("button", { name: "Enter" }).click();
  await admin.getByText("Wrong passphrase.").waitFor();
  check(true, "wrong passphrase shows error");
  await admin.getByPlaceholder("Passphrase").fill(secret);
  await admin.getByRole("button", { name: "Enter" }).click();
  await admin.locator(".controls").waitFor();
  check(true, "admin logged in");

  await admin.getByLabel("Also forget all players").check();
  await confirm(admin, "Reset everything");
  await admin.getByText("Join the game").waitFor();
  await admin.getByLabel("Vote").fill("2");
  await admin.getByLabel("Pause between turns").fill("0.5");
  await admin.getByLabel("Pause between turns").blur();
  await admin.waitForTimeout(1500);
  check(
    (await admin.getByLabel("Vote").inputValue()) === "2" &&
      (await admin.getByLabel("Pause between turns").inputValue()) === "0.5",
    "both timing settings persist"
  );

  let waitTotal = (n: number) =>
    admin.waitForFunction(
      n =>
        [...document.querySelectorAll(".team-counts.big span")]
          .map(e => Number(e.textContent))
          .reduce((a, b) => a + b, 0) === n,
      n,
      { timeout: 10_000 }
    );
  await admin.waitForTimeout(3500);
  let baseline = await admin.evaluate(() =>
    [...document.querySelectorAll(".team-counts.big span")]
      .map(e => Number(e.textContent))
      .reduce((a, b) => a + b, 0)
  );
  if (baseline > 0)
    console.log(`  (${baseline} other connected players present)`);

  let students = await Promise.all([0, 1, 2, 3].map(() => newPage()));
  pages.push(...students);
  for (let s of students)
    await s.getByText(/You're on Team (Red|Blue)/).waitFor();
  let teams = await Promise.all(
    students.map(async s =>
      ((await s.locator(".team-banner").textContent()) ?? "").includes("Red")
        ? "red"
        : "blue"
    )
  );
  check(
    teams.includes("red") && teams.includes("blue"),
    `students on both teams (${teams.join(",")})`
  );
  await waitTotal(baseline + 4);
  check(true, "admin lobby shows team counts");

  let extra = await newPage();
  await extra.getByText(/You're on Team/).waitFor();
  await waitTotal(baseline + 5);
  await extra.close();
  await waitTotal(baseline + 4);
  check(true, "closing a tab drops it from the admin count");
  let reloaded = students[0];
  await reloaded.reload();
  await reloaded
    .getByText(`You're on Team ${teams[0] === "red" ? "Red" : "Blue"}`)
    .waitFor();
  check(true, "refresh keeps the same team");

  let playGame = async (
    button: string,
    tileClass: string,
    plan: number[],
    winText: RegExp
  ) => {
    await admin.getByRole("button", { name: button }).click();
    await admin.locator(".controls button", { hasText: "Restart" }).click();
    await admin.getByRole("button", { name: "Click again to confirm" }).click();
    await admin
      .locator(".status-text", { hasText: "Paused. Red moves next." })
      .waitFor();
    await admin.getByRole("button", { name: "▶ Play" }).click();
    await admin.getByRole("button", { name: "❚❚ Pause" }).waitFor();
    for (let [i, move] of plan.entries()) {
      let team = i % 2 === 0 ? "red" : "blue";
      let voters = students.filter((_, j) => teams[j] === team);
      let others = students.filter((_, j) => teams[j] !== team);
      let tile = (p: Page) => p.locator(`.${tileClass}[data-move="${move}"]`);
      await tile(voters[0])
        .and(voters[0].locator(".enabled"))
        .waitFor({ timeout: 10_000 });
      check(
        await tile(others[0]).isDisabled(),
        `move ${i + 1}: off-turn team cannot click`
      );
      for (let v of voters) await tile(v).click();
      await tile(voters[0]).and(voters[0].locator(".voted")).waitFor();
      await admin
        .locator(`.${tileClass}[data-move="${move}"] .tally-count`, {
          hasText: String(voters.length)
        })
        .waitFor({ timeout: 3000 });
      await tile(others[0])
        .and(others[0].locator(`.${team}`))
        .waitFor({ timeout: 10_000 });
      check(true, `move ${i + 1}: ${team} took ${move}, visible to other team`);
    }
    await admin
      .locator(".status-text", { hasText: winText })
      .waitFor({ timeout: 10_000 });
    for (let s of students)
      await s
        .locator(".status-text", { hasText: winText })
        .waitFor({ timeout: 10_000 });
    check(true, `everyone sees ${winText}`);
  };

  console.log("Pick 15");
  await playGame("Pick 15", "num", [2, 1, 6, 3, 7], /Red wins!/);
  let stripText = await students[0].getByTestId("strip").textContent();
  check(stripText === "123456789", "strip shows only digits, no sums");
  await admin.screenshot({ path: `${SHOTS}/admin-ns.png` });
  check(
    await admin.evaluate(() => {
      let tops = [...document.querySelectorAll(".projector .num")].map(
        e => (e as HTMLElement).offsetTop
      );
      return new Set(tops).size === 1;
    }),
    "admin strip fits on one row"
  );
  await students[0].screenshot({ path: `${SHOTS}/student-ns.png` });

  console.log("Tic-tac-toe");
  await playGame("Tic-tac-toe", "cell", [4, 0, 2, 6, 3, 5, 1, 7, 8], /draw/);
  await students[1].screenshot({ path: `${SHOTS}/student-ttt.png` });

  console.log("Reveal");
  await admin.getByRole("button", { name: "Reveal" }).click();
  await students[0]
    .getByText("Here's the tic-tac-toe game you just played.")
    .waitFor();
  await admin.keyboard.press("ArrowRight");
  await students[0].getByText(/Every row, column, and diagonal/).waitFor();
  for (let i = 0; i < 6; i++) {
    await admin.getByRole("button", { name: "Next ▶" }).click();
    await admin.getByText(`Reveal step ${i + 2} /`).waitFor();
  }
  await students[0].getByText(/same game all along/).waitFor({ timeout: 5000 });
  check(
    (await students[0].locator(".board .winning").count()) === 3,
    "reveal highlights winning line on board"
  );
  await students[0].screenshot({ path: `${SHOTS}/student-reveal.png` });

  for (let s of students) await s.context().close();
  await admin.getByRole("button", { name: "Lobby" }).click();
  await admin.getByLabel("Vote").fill("5");
  await admin.getByLabel("Pause between turns").fill("2");
  await admin.getByLabel("Pause between turns").blur();
  await admin.getByLabel("Also forget all players").check();
  await confirm(admin, "Reset everything");
  await waitTotal(baseline);
  console.log("reset to lobby");
  console.log("BROWSER SMOKE PASSED");
} catch (e) {
  for (let [i, p] of pages.entries())
    await p.screenshot({ path: `${SHOTS}/fail-${i}.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  server.close();
}

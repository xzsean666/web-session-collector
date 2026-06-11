import type { Locator, Page } from "playwright";

// 站点无关的「拟人」交互原语:随机化时序、分步滚动、带曲线的鼠标移动、
// 逐字打字。各站点 adapter / 搜索 workflow 共用,集中在这里便于统一调参。
//
// 设计取舍:不追求"完美人类",只去掉最容易被行为风控抓到的机器特征——
// 瞬间跳转的滚动、毫秒级一致的固定等待、完美直线的鼠标、零间隔的输入。
// 所有动作对失败都尽量吞掉(catch),拟人是「尽力而为」,不应让采集主流程报错。

// [min, max] 闭区间随机整数。
export function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return low + Math.floor(Math.random() * (high - low + 1));
}

// 随机停顿,替代到处写死的 waitForTimeout(固定值)。
export async function humanPause(
  page: Page,
  minMs: number,
  maxMs: number
): Promise<void> {
  await page.waitForTimeout(randomInt(minMs, maxMs));
}

export interface HumanScrollOptions {
  // 滚动「步数」;不传则随机 4~8 步。
  readonly steps?: number;
}

// 人类式滚动:把一次大跳拆成若干小步,用真实 wheel 事件(而非 window.scrollBy),
// 步长/间隔随机,偶尔小幅回滚、偶尔较长停顿,像在边滑边看。
export async function humanScroll(
  page: Page,
  options: HumanScrollOptions = {}
): Promise<void> {
  const viewportHeight = page.viewportSize()?.height ?? 768;
  const steps = options.steps ?? randomInt(4, 8);

  for (let index = 0; index < steps; index += 1) {
    const delta = randomInt(
      Math.round(viewportHeight * 0.18),
      Math.round(viewportHeight * 0.42)
    );
    await page.mouse.wheel(0, delta).catch(() => undefined);
    await humanPause(page, 220, 650);

    // 偶尔向上回滚一点,像在确认刚划过的内容。
    if (Math.random() < 0.15) {
      await page.mouse.wheel(0, -randomInt(40, 120)).catch(() => undefined);
      await humanPause(page, 200, 500);
    }
  }

  // 偶尔一次较长停顿,像停下来阅读。
  if (Math.random() < 0.3) {
    await humanPause(page, 800, 1_800);
  }
}

// 把鼠标移动到 (x, y):先经过一个带抖动的中间点再到目标,并对落点做微小偏移,
// 避免完美直线 / 像素级精确命中这种机器特征。Playwright 的 steps 会插值出
// 连续的 mousemove 事件。
export async function humanMouseMoveTo(
  page: Page,
  x: number,
  y: number
): Promise<void> {
  const midX = x + randomInt(-60, 60);
  const midY = y + randomInt(-40, 40);

  await page.mouse
    .move(midX, midY, { steps: randomInt(8, 16) })
    .catch(() => undefined);
  await humanPause(page, 40, 140);
  await page.mouse
    .move(x + randomInt(-3, 3), y + randomInt(-3, 3), {
      steps: randomInt(8, 18)
    })
    .catch(() => undefined);
}

// 在坐标处「拟人」点击:移动过去、停顿、按下/抬起之间留出按键时长。
export async function humanClickAt(
  page: Page,
  x: number,
  y: number
): Promise<void> {
  await humanMouseMoveTo(page, x, y);
  await humanPause(page, 60, 180);
  await page.mouse.down().catch(() => undefined);
  await humanPause(page, 40, 110);
  await page.mouse.up().catch(() => undefined);
}

// 对一个元素做拟人点击:命中其内部一个随机点(非正中心)。拿不到包围盒时
// 回退到普通 click。
export async function humanClick(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox().catch(() => null);

  if (box === null) {
    await locator.click({ timeout: 5_000 }).catch(() => undefined);
    return;
  }

  const x = box.x + box.width * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);
  await humanClickAt(page, x, y);
}

// 逐字输入,每个字符之间随机延迟,偶尔一次较长「思考」停顿。
export async function humanType(
  page: Page,
  locator: Locator,
  text: string
): Promise<void> {
  for (const character of text) {
    await locator
      .pressSequentially(character, { delay: randomInt(60, 180) })
      .catch(() => undefined);

    if (Math.random() < 0.08) {
      await humanPause(page, 200, 500);
    }
  }
}

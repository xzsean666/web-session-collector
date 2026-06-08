import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { loadLocalEnvFile } from "../core/config/local-env-file.js";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import type { SearchItem } from "../core/search/search-types.js";
import { createLogger, serializeError } from "../core/monitoring/logger.js";
import type { LogLevel } from "../core/types/runtime.js";
import {
  runSearchTaskWithNewBrowser,
  type SearchKeywordResult
} from "../runtime/search-task.js";
import { listSearchSiteKeys } from "../sites/site-registry.js";

type CollectTaskName = "search";

interface CollectCliOptions {
  readonly taskName: CollectTaskName;
  readonly siteKey: string;
  readonly keywords: readonly string[];
  readonly recentDays: number;
  readonly limitPerKeyword: number;
  readonly scrollCount: number;
  readonly json: boolean;
  readonly headed: boolean;
  readonly help: boolean;
}

type PrintableKeywordResult = SearchKeywordResult;

async function main(): Promise<void> {
  loadLocalEnvFile();

  const cliOptions = await resolveCliOptions(process.argv.slice(2));

  if (cliOptions.help) {
    printHelp();
    return;
  }

  if (cliOptions.taskName !== "search") {
    throw new Error(`Unsupported task "${cliOptions.taskName}".`);
  }

  if (cliOptions.keywords.length === 0) {
    throw new Error("At least one keyword is required.");
  }

  const runtimeConfig = loadRuntimeConfig({
    ...process.env,
    APP_HEADLESS: cliOptions.headed ? "false" : process.env.APP_HEADLESS
  });
  const logger = createLogger({
    level: parseSearchLogLevel(process.env.APP_SEARCH_LOG_LEVEL)
  });

  const searchTaskResult = await runSearchTaskWithNewBrowser(
    runtimeConfig,
    {
      siteKey: cliOptions.siteKey,
      keywords: cliOptions.keywords,
      recentDays: cliOptions.recentDays,
      limitPerKeyword: cliOptions.limitPerKeyword,
      scrollCount: cliOptions.scrollCount
    },
    logger
  );

  if (cliOptions.json) {
    console.log(JSON.stringify(searchTaskResult.results, null, 2));
    return;
  }

  printKeywordResults(searchTaskResult.results, cliOptions);
}

async function resolveCliOptions(
  rawArguments: readonly string[]
): Promise<CollectCliOptions> {
  const parsedOptions = parseCliOptions(rawArguments);

  if (parsedOptions.help || parsedOptions.keywords.length > 0) {
    return parsedOptions;
  }

  const promptedKeywords = await promptForKeywords();

  return {
    ...parsedOptions,
    keywords: promptedKeywords
  };
}

function parseCliOptions(rawArguments: readonly string[]): CollectCliOptions {
  const keywords: string[] = [];
  let taskName: CollectTaskName = parseTaskName(process.env.APP_TASK, "APP_TASK");
  let siteKey =
    process.env.APP_SEARCH_SITE ??
    process.env.APP_SITE ??
    "xiaohongshu";
  let recentDays = parseNumberOption(
    process.env.APP_SEARCH_RECENT_DAYS,
    30
  );
  let limitPerKeyword = parseNumberOption(
    process.env.APP_SEARCH_LIMIT,
    10
  );
  let scrollCount = parseNumberOption(
    process.env.APP_SEARCH_SCROLLS,
    2
  );
  let json = false;
  let headed = false;
  let help = false;

  for (let index = 0; index < rawArguments.length; index += 1) {
    const argument = rawArguments[index] ?? "";

    if (argument === "--") {
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }

    if (argument === "--json") {
      json = true;
      continue;
    }

    if (argument === "--headed") {
      headed = true;
      continue;
    }

    if (argument.startsWith("--task=")) {
      taskName = parseTaskName(argument.slice("--task=".length), "--task");
      continue;
    }

    if (argument === "--task") {
      taskName = parseTaskName(rawArguments[index + 1], "--task");
      index += 1;
      continue;
    }

    if (argument.startsWith("--site=")) {
      siteKey = parseRequiredStringOption(argument.slice("--site=".length), "--site");
      continue;
    }

    if (argument === "--site") {
      siteKey = parseRequiredStringOption(rawArguments[index + 1], "--site");
      index += 1;
      continue;
    }

    if (argument.startsWith("--days=")) {
      recentDays = parseRequiredNumberOption(argument.slice("--days=".length), "--days");
      continue;
    }

    if (argument === "--days") {
      recentDays = parseRequiredNumberOption(rawArguments[index + 1], "--days");
      index += 1;
      continue;
    }

    if (argument.startsWith("--limit=")) {
      limitPerKeyword = parseRequiredNumberOption(
        argument.slice("--limit=".length),
        "--limit"
      );
      continue;
    }

    if (argument === "--limit") {
      limitPerKeyword = parseRequiredNumberOption(rawArguments[index + 1], "--limit");
      index += 1;
      continue;
    }

    if (argument.startsWith("--scrolls=")) {
      scrollCount = parseRequiredNumberOption(
        argument.slice("--scrolls=".length),
        "--scrolls"
      );
      continue;
    }

    if (argument === "--scrolls") {
      scrollCount = parseRequiredNumberOption(
        rawArguments[index + 1],
        "--scrolls"
      );
      index += 1;
      continue;
    }

    keywords.push(...splitKeywordText(argument));
  }

  return {
    taskName,
    siteKey,
    keywords: dedupeKeywords(keywords),
    recentDays,
    limitPerKeyword,
    scrollCount,
    json,
    headed,
    help
  };
}

function parseSearchLogLevel(value: string | undefined): LogLevel {
  const allowedLevels: readonly LogLevel[] = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
    "silent"
  ];

  if (value !== undefined && allowedLevels.includes(value as LogLevel)) {
    return value as LogLevel;
  }

  return "warn";
}

async function promptForKeywords(): Promise<readonly string[]> {
  const readline = createInterface({ input, output });

  try {
    const answer = await readline.question(
      "请输入关键词，多个关键词用空格、逗号或顿号分隔："
    );
    return dedupeKeywords(splitKeywordText(answer));
  } finally {
    readline.close();
  }
}

function splitKeywordText(value: string): readonly string[] {
  return value
    .split(/[\s,，、]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

function dedupeKeywords(keywords: readonly string[]): readonly string[] {
  const seenKeywords = new Set<string>();
  const dedupedKeywords: string[] = [];

  for (const keyword of keywords) {
    if (seenKeywords.has(keyword)) {
      continue;
    }

    seenKeywords.add(keyword);
    dedupedKeywords.push(keyword);
  }

  return dedupedKeywords;
}

function printKeywordResults(
  results: readonly PrintableKeywordResult[],
  cliOptions: CollectCliOptions
): void {
  console.log("最近相关结果");
  console.log(`生成时间：${formatDateTime(new Date())}`);
  console.log(
    `站点：${cliOptions.siteKey}；范围：${
      cliOptions.recentDays === 0 ? "不过滤日期" : `最近 ${cliOptions.recentDays} 天`
    }；每个关键词最多 ${cliOptions.limitPerKeyword} 条；滚动 ${cliOptions.scrollCount} 次`
  );

  for (const result of results) {
    console.log("");
    console.log(`## ${result.keyword}`);
    console.log(`搜索页：${result.searchUrl}`);
    console.log(
      `页面收集：${result.collectedCount} 条；有效去重：${result.normalizedCount} 条；符合范围：${result.inRangeCount} 条；输出：${result.matchedItems.length} 条`
    );

    if (cliOptions.recentDays !== 0 && result.unknownDateCount > 0) {
      console.log(
        `其中 ${result.unknownDateCount} 条发布时间缺失或无法解析，未计入最近 ${cliOptions.recentDays} 天。`
      );
    }

    if (result.usedFallback) {
      console.log(
        `未找到指定时间范围内的可解析结果，下面显示已收集结果中最近的 ${result.matchedItems.length} 条。`
      );
    }

    if (result.matchedItems.length === 0) {
      console.log("没有收集到结果。");
      continue;
    }

    result.matchedItems.forEach((item, index) => {
      console.log("");
      console.log(`${index + 1}. ${item.title}`);
      console.log(`   作者：${item.author || "未知"}`);
      console.log(
        `   时间：${formatPublishedAt(item)}${
          item.likeCountText === "" ? "" : ` | 点赞：${item.likeCountText}`
        }`
      );
      console.log(`   链接：${item.url}`);
    });
  }
}

function formatPublishedAt(item: SearchItem): string {
  const dateText = item.publishedAt === "" ? "" : formatDate(new Date(item.publishedAt));
  const ageText = item.ageDays === undefined ? "" : `，约 ${item.ageDays} 天前`;

  if (dateText === "") {
    return item.publishedAtText || "未知";
  }

  return `${item.publishedAtText}（${dateText}${ageText}）`;
}

function formatDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatDateTime(date: Date): string {
  return `${formatDate(date)} ${[
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ].join(":")}`;
}

function parseNumberOption(
  value: string | undefined,
  defaultValue: number
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  return parseRequiredNumberOption(value, "environment option");
}

function parseRequiredNumberOption(
  value: string | undefined,
  optionName: string
): number {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${optionName} requires a number.`);
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`${optionName} must be a non-negative integer.`);
  }

  return parsedValue;
}

function parseRequiredStringOption(
  value: string | undefined,
  optionName: string
): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${optionName} requires a non-empty value.`);
  }

  return value.trim();
}

function parseTaskName(
  value: string | undefined,
  optionName: string
): CollectTaskName {
  if (value === undefined || value.trim() === "") {
    return "search";
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "search") {
    return "search";
  }

  throw new Error(`${optionName} must be one of: search.`);
}

function printHelp(): void {
  console.log(`Usage:
  pnpm run collect:xiaohongshu -- <关键词...>
  pnpm run collect -- --site=xiaohongshu [--task=search] <关键词...>
  pnpm run collect -- --site=xiaohongshu

Examples:
  pnpm run collect:xiaohongshu -- 咖啡 成都
  pnpm run collect -- --site=xiaohongshu --task=search 咖啡 成都
  pnpm run collect:xiaohongshu -- "咖啡,露营,上海" --days=14 --limit=8
  pnpm run collect:xiaohongshu -- 咖啡 --headed

Options:
  --task <name>        采集任务，当前支持 search
  --site <name>        站点适配器，默认 xiaohongshu；可用：${listSearchSiteKeys().join(", ")}
  --days <number>      只显示最近 N 天；0 表示不过滤日期，默认 30
  --limit <number>     每个关键词最多输出 N 条，默认 10
  --scrolls <number>   每个关键词搜索页向下滚动次数，默认 2
  --headed             可见浏览器调试运行，覆盖 APP_HEADLESS=false
  --json               输出 JSON
  --help               显示帮助
`);
}

main().catch((error: unknown) => {
  console.error("Collect script failed.");
  console.error(serializeError(error));
  process.exitCode = 1;
});

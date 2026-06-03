import { existsSync, readFileSync } from "node:fs";

export function loadLocalEnvFile(filePath = ".env"): void {
  if (!existsSync(filePath)) {
    return;
  }

  const fileContent = readFileSync(filePath, "utf8");

  for (const line of fileContent.split(/\r?\n/)) {
    const parsedLine = parseEnvLine(line);

    if (parsedLine === undefined || process.env[parsedLine.name] !== undefined) {
      continue;
    }

    process.env[parsedLine.name] = parsedLine.value;
  }
}

function parseEnvLine(
  line: string
): { readonly name: string; readonly value: string } | undefined {
  const trimmedLine = line.trim();

  if (trimmedLine === "" || trimmedLine.startsWith("#")) {
    return undefined;
  }

  const separatorIndex = trimmedLine.indexOf("=");

  if (separatorIndex <= 0) {
    return undefined;
  }

  const name = trimmedLine.slice(0, separatorIndex).trim();
  const rawValue = trimmedLine.slice(separatorIndex + 1).trim();

  if (name === "") {
    return undefined;
  }

  return {
    name,
    value: unwrapQuotedValue(rawValue)
  };
}

function unwrapQuotedValue(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const quote = value[0];
  const lastCharacter = value[value.length - 1];

  if ((quote === "'" || quote === '"') && lastCharacter === quote) {
    return value.slice(1, -1);
  }

  return value;
}

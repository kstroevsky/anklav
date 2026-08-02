export type ParsedArguments = { command: string | undefined; positionals: string[]; flags: Record<string, string | boolean> };

export function parseArguments(argv: readonly string[]): ParsedArguments {
  const [command, ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]!;
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const [rawName, inline] = value.slice(2).split('=', 2);
    if (!rawName) throw new Error(`Invalid option: ${value}`);
    if (inline !== undefined) { flags[rawName] = inline; continue; }
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) { flags[rawName] = next; index += 1; }
    else flags[rawName] = true;
  }
  return { command, positionals, flags };
}

export function stringFlag(arguments_: ParsedArguments, name: string): string | undefined {
  const value = arguments_.flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`--${name} requires a value.`);
  return value;
}

export function booleanFlag(arguments_: ParsedArguments, name: string): boolean { return arguments_.flags[name] === true; }

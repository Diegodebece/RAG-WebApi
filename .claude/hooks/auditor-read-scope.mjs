// PreToolUse hook of the code-auditor subagent (.claude/agents/code-auditor.md): it may read only the code, the
// tests, the migrations and a few configuration files. Everything else is out of reach: the design notes and
// skills (so the audit does not inherit the author's assumptions), the private documents in "RAG project", the
// brief and .env (so it never sees private files or secrets). Grep and Glob must name an allowed path, because a
// search of the whole project would return text from blocked files. SubagentHandback is allowed too: it is how
// a subagent hands its final report back, and it only carries text. Any other tool (writing, editing, shell,
// network) or anything unexpected is denied.

import path from "node:path";

// first path component, compared in lower case (Windows paths ignore case)
const ALLOWED_DIRECTORIES = new Set(["src", "test", "migrations", "node_modules"]);
const ALLOWED_FILES = new Set([
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.test.json",
    "docker-compose.yml",
    ".env.example",
    ".gitignore"
]);
const ALLOWED_DESCRIPTION = "src/, test/, migrations/, node_modules/ and package.json, package-lock.json, tsconfig.json, tsconfig.test.json, docker-compose.yml, .env.example, .gitignore";

const readStdin = async () => {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
};

const deny = (reason) => {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `${reason} The audit may only read ${ALLOWED_DESCRIPTION}.`
        }
    }));
    process.exit(0);
};

// True when the path, resolved against the project, is inside an allowed directory or is an allowed file.
// The project root itself is not allowed: a search there would cover the blocked files too.
const isAllowedPath = (projectDir, target) => {
    const relative = path.relative(projectDir, path.resolve(projectDir, target));

    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
    }

    const parts = relative.split(path.sep).map((part) => part.toLowerCase());

    return ALLOWED_DIRECTORIES.has(parts[0]) || (parts.length === 1 && ALLOWED_FILES.has(parts[0]));
};

// a glob that could climb out of its search path or point somewhere else entirely
const isEscapingPattern = (pattern) => pattern.includes("..") || path.isAbsolute(pattern) || /^[a-z]:/i.test(pattern);

const main = async () => {
    let input;

    try {
        input = JSON.parse(await readStdin());
    } catch {
        deny("The tool call could not be read.");
    }

    const toolName = String(input.tool_name ?? "");
    const toolInput = input.tool_input ?? {};
    const projectDir = process.env.CLAUDE_PROJECT_DIR || String(input.cwd ?? "") || process.cwd();

    if (toolName === "SubagentHandback") {
        // the final report: it returns text to the caller and touches nothing
    } else if (toolName === "Read") {
        const filePath = String(toolInput.file_path ?? "");

        if (!filePath || !isAllowedPath(projectDir, filePath)) {
            deny(`Reading ${filePath || "that file"} is not allowed.`);
        }
    } else if (toolName === "Grep" || toolName === "Glob") {
        const searchPath = String(toolInput.path ?? "");
        const pattern = String((toolName === "Glob" ? toolInput.pattern : toolInput.glob) ?? "");

        if (!searchPath) {
            deny(`${toolName} needs a path inside the allowed folders (for example "src").`);
        }

        if (!isAllowedPath(projectDir, searchPath) || isEscapingPattern(pattern)) {
            deny(`Searching ${searchPath} is not allowed.`);
        }
    } else {
        deny(`The ${toolName} tool is not part of the audit.`);
    }

    process.exit(0);
};

await main();

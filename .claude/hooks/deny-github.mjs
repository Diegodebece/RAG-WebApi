// PreToolUse hook: deny every GitHub access so the user handles GitHub themselves.
// Blocks GitHub MCP tools, WebFetch to GitHub, the gh CLI, git network commands and any
// shell command that mentions github.com. Local git (init, add, commit, status, ...) stays allowed.

const GIT_NETWORK_SUBCOMMANDS = new Set(["push", "pull", "fetch", "clone", "ls-remote", "submodule"]);
const GIT_REMOTE_WRITE_ACTIONS = new Set(["add", "set-url"]);
// git options that take a separate value: `git -C <path> push`
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

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
            permissionDecisionReason: `${reason} GitHub is handled by the user in this project: give them the exact command to run instead.`
        }
    }));
    process.exit(0);
};

// "gh" or "git" when the token is that executable, also written as a path (C:\...\gh.exe, /usr/bin/git).
const toolName = (token) => {
    const fileName = token.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, "");
    return fileName === "gh" || fileName === "git" ? fileName : null;
};

// Returns why a shell command touches GitHub, or null when it is local-only.
const findGitHubAccess = (command) => {
    if (/github\.com|githubusercontent\.com/i.test(command)) {
        return "The command references a GitHub URL.";
    }

    // Quoted strings (paths with spaces, commit messages) become one placeholder token, so
    // `git -C "RAG project" fetch` parses correctly and `-m "push the fix"` is not a subcommand.
    // A quoted path to the gh or git executable keeps its file name, so it cannot hide the tool.
    const unquoted = command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (quoted) => {
        const fileName = toolName(quoted.slice(1, -1));
        return fileName ?? "QUOTED";
    });
    const segments = unquoted.split(/&&|\|\||[;|&\n]|\$\(|`/);

    for (const segment of segments) {
        const tokens = segment.trim().split(/\s+/).filter(Boolean);
        const toolIndex = tokens.findIndex((token) => toolName(token) !== null);

        if (toolIndex === -1) {
            continue;
        }

        const tool = toolName(tokens[toolIndex]);

        if (tool === "gh") {
            return "The gh CLI talks to GitHub.";
        }

        let index = toolIndex + 1;
        while (index < tokens.length && tokens[index].startsWith("-")) {
            index += GIT_OPTIONS_WITH_VALUE.has(tokens[index]) ? 2 : 1;
        }

        const subcommand = tokens[index];
        if (GIT_NETWORK_SUBCOMMANDS.has(subcommand)) {
            return `"git ${subcommand}" contacts a remote.`;
        }
        if (subcommand === "remote" && GIT_REMOTE_WRITE_ACTIONS.has(tokens[index + 1])) {
            return `"git remote ${tokens[index + 1]}" configures a remote.`;
        }
        // an alias such as `git config alias.sync push` would let `git sync` push without being recognized
        if (subcommand === "config" && tokens.slice(index + 1).some((token) => /^alias\./i.test(token))) {
            return "Git aliases can hide network commands.";
        }
    }

    return null;
};

const main = async () => {
    const input = JSON.parse(await readStdin());
    const toolName = String(input.tool_name ?? "");
    const toolInput = input.tool_input ?? {};

    if (/github/i.test(toolName)) {
        deny(`The ${toolName} tool is a GitHub integration.`);
    }

    if (toolName === "WebFetch" && /github\.com|githubusercontent\.com/i.test(String(toolInput.url ?? ""))) {
        deny("Fetching GitHub pages is blocked.");
    }

    if (toolName === "Bash" || toolName === "PowerShell") {
        const reason = findGitHubAccess(String(toolInput.command ?? ""));
        if (reason) {
            deny(reason);
        }
    }

    process.exit(0);
};

await main();

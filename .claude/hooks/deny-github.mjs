// PreToolUse hook: the user handles GitHub and branches in this project, so Claude Code may not.
// Blocks GitHub MCP tools, WebFetch to GitHub, the gh CLI, git network commands, any shell command that
// mentions github.com, and every way of creating, switching, moving or deleting a branch or worktree.
// Local git (add, commit, status, diff, log, listing branches, restoring files, ...) stays allowed.

const GIT_NETWORK_SUBCOMMANDS = new Set(["push", "pull", "fetch", "clone", "ls-remote", "submodule"]);
const GIT_REMOTE_WRITE_ACTIONS = new Set(["add", "set-url"]);
// git options that take a separate value: `git -C <path> push`
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

// `git branch` options that only list; with one of them, a name is a pattern, not a branch to create
const BRANCH_LISTING_OPTIONS = new Set([
    "-l", "--list", "-a", "--all", "-r", "--remotes", "--show-current",
    "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"
]);
// `git branch` options that delete a branch or move an existing one to another commit
const BRANCH_DESTRUCTIVE_OPTIONS = new Set(["-d", "-D", "--delete", "-f", "--force"]);
// `git branch` options that create a branch under a new name
const BRANCH_RENAMING_OPTIONS = new Set(["-m", "-M", "--move", "-c", "-C", "--copy"]);
// `git branch` options that take a separate value, which is not a branch name to create
const BRANCH_OPTIONS_WITH_VALUE = new Set(["-u", "--set-upstream-to", "--format", "--sort", "--color", "--column"]);

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
            permissionDecisionReason: `${reason} The user handles GitHub and branches in this project: give them the exact command to run instead.`
        }
    }));
    process.exit(0);
};

// "gh" or "git" when the token is that executable, also written as a path (C:\...\gh.exe, /usr/bin/git).
const toolName = (token) => {
    const fileName = token.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, "");
    return fileName === "gh" || fileName === "git" ? fileName : null;
};

// Why `git branch <args>` changes branches, or null when it only lists or configures.
const findBranchChange = (args) => {
    if (args.some((token) => BRANCH_DESTRUCTIVE_OPTIONS.has(token))) {
        return "Deleting or moving a branch changes the user's branches.";
    }
    if (args.some((token) => BRANCH_RENAMING_OPTIONS.has(token))) {
        return "Renaming or copying a branch creates a new branch name.";
    }
    if (args.some((token) => BRANCH_LISTING_OPTIONS.has(token))) {
        return null;
    }

    for (let index = 0; index < args.length; index++) {
        if (BRANCH_OPTIONS_WITH_VALUE.has(args[index])) {
            index++;
        } else if (!args[index].startsWith("-")) {
            return `"git branch ${args[index]}" creates a branch.`;
        }
    }

    return null;
};

// Returns why a shell command touches GitHub or creates a branch, or null when it is local-only.
const findBlockedGitAction = (command) => {
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

        const args = tokens.slice(index + 1);
        if (subcommand === "switch") {
            return "\"git switch\" changes or creates branches.";
        }
        // `git checkout -- <files>` only restores files; without `--`, a name may be a branch to switch to
        // (or a branch to create with -b), and it cannot be told apart from a file name. `git restore` stays allowed.
        if (subcommand === "checkout" && !args.includes("--")) {
            return "\"git checkout\" without \"--\" can switch or create branches; use \"git restore\" for files.";
        }
        if (subcommand === "branch") {
            const reason = findBranchChange(args);
            if (reason) {
                return reason;
            }
        }
        if (subcommand === "stash" && args[0] === "branch") {
            return "\"git stash branch\" creates a branch.";
        }
        if (subcommand === "worktree" && args[0] === "add") {
            return "\"git worktree add\" creates a worktree and usually a branch.";
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

    if (toolName === "EnterWorktree") {
        deny("Creating a worktree also creates a branch.");
    }

    if (toolName === "Bash" || toolName === "PowerShell") {
        const reason = findBlockedGitAction(String(toolInput.command ?? ""));
        if (reason) {
            deny(reason);
        }
    }

    process.exit(0);
};

await main();

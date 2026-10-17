import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Runs the hook the way Claude Code does: the tool call as JSON on stdin, the decision as JSON on stdout.
const decide = (toolName: string, toolInput: object): "deny" | "allow" => {
    const result = spawnSync(process.execPath, [".claude/hooks/deny-github.mjs"], {
        input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
        encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    return result.stdout.includes("\"permissionDecision\":\"deny\"") ? "deny" : "allow";
};

const shell = (command: string) => decide("Bash", { command });

describe("deny-github hook", () => {
    it("blocks git commands that contact a remote", () => {
        for (const command of [
            "git push -u origin HEAD",
            "git pull",
            "git fetch --all",
            "git clone https://example.com/repo.git",
            "git ls-remote origin",
            "git submodule update",
            "cd app && git push",
            "git -C \"RAG project\" fetch",
            "git -c user.name=x push",
            "git remote add origin https://example.com/repo.git",
            "git remote set-url origin https://example.com/repo.git"
        ]) {
            assert.equal(shell(command), "deny", command);
        }
    });

    it("blocks the gh CLI and GitHub URLs, also from PowerShell and WebFetch", () => {
        assert.equal(shell("gh pr list"), "deny");
        assert.equal(shell("echo $(gh auth status)"), "deny");
        assert.equal(shell("curl https://api.github.com/user"), "deny");
        assert.equal(decide("PowerShell", { command: "git push" }), "deny");
        assert.equal(decide("WebFetch", { url: "https://github.com/someone/repo" }), "deny");
        assert.equal(decide("mcp__plugin_github_github__create_pull_request", {}), "deny");
    });

    it("blocks gh and git called through a full path, quoted or not", () => {
        for (const command of [
            "\"C:\\Program Files\\GitHub CLI\\gh.exe\" repo list",
            "& 'C:\\Program Files\\Git\\cmd\\git.exe' push",
            "C:\\Git\\cmd\\git.exe pull",
            "/usr/bin/git fetch"
        ]) {
            assert.equal(shell(command), "deny", command);
        }
    });

    it("blocks creating git aliases, which could hide a push", () => {
        assert.equal(shell("git config alias.sync push"), "deny");
        assert.equal(shell("git config --global alias.up \"!git push\""), "deny");
    });

    it("blocks every way of creating a branch or a worktree", () => {
        for (const command of [
            "git switch -c feature/documents",
            "git switch --create feature/documents",
            "git switch -C feature/documents",
            "git checkout -b feature/documents",
            "git checkout -B feature/documents",
            "git checkout --orphan gh-pages",
            "git branch feature/documents",
            "git branch -m better-name",
            "git branch -c copy-of-main",
            "git stash branch feature/stash",
            "git worktree add ../rag-web-review",
            "git status && git switch -c sneaky"
        ]) {
            assert.equal(shell(command), "deny", command);
        }
        assert.equal(decide("EnterWorktree", {}), "deny");
    });

    it("blocks switching, moving and deleting branches", () => {
        for (const command of [
            "git switch main",
            "git switch -",
            "git checkout main",
            "git checkout feature/documents",
            "git checkout .",
            "git branch -d feature/old",
            "git branch -D feature/old",
            "git branch --delete feature/old",
            "git branch -f main HEAD~1",
            "cd app && git switch main"
        ]) {
            assert.equal(shell(command), "deny", command);
        }
    });

    it("allows listing branches and restoring files", () => {
        for (const command of [
            "git branch",
            "git branch -a",
            "git branch -vv",
            "git branch --show-current",
            "git branch --list \"feature/*\"",
            "git branch --merged",
            "git branch -u origin/main",
            "git checkout -- src/app.ts",
            "git checkout HEAD -- src/app.ts",
            "git restore src/app.ts",
            "git restore --staged src/app.ts",
            "git stash",
            "git stash pop",
            "git worktree list"
        ]) {
            assert.equal(shell(command), "allow", command);
        }
    });

    it("allows local git and unrelated commands", () => {
        for (const command of [
            "git status --short",
            "git add .",
            "git commit -m \"push the fix, then pull\"",
            "git log --oneline -5",
            "git remote -v",
            "git config --get user.name",
            "git -C \"RAG project\" status",
            "npm test"
        ]) {
            assert.equal(shell(command), "allow", command);
        }
        assert.equal(decide("Read", { file_path: "README.md" }), "allow");
    });
});

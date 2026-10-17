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

    it("allows local git and unrelated commands", () => {
        for (const command of [
            "git status --short",
            "git add .",
            "git commit -m \"push the fix, then pull\"",
            "git log --oneline -5",
            "git switch -c feature/auth",
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

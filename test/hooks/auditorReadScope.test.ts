import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const projectDir = process.cwd();

// Runs the hook the way Claude Code does: the tool call as JSON on stdin, the decision as JSON on stdout.
const decide = (toolName: string, toolInput: object, rawInput?: string): "deny" | "allow" => {
    const result = spawnSync(process.execPath, [".claude/hooks/auditor-read-scope.mjs"], {
        input: rawInput ?? JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
    });

    assert.equal(result.status, 0, result.stderr);
    return result.stdout.includes("\"permissionDecision\":\"deny\"") ? "deny" : "allow";
};

const read = (filePath: string) => decide("Read", { file_path: filePath });

describe("auditor-read-scope hook", () => {
    it("lets the auditor read the code, the tests, the migrations and the allowed configuration files", () => {
        for (const filePath of [
            "src/app.ts",
            path.join(projectDir, "src", "v1", "services", "questions.service.ts"),
            "test/routes/events.test.ts",
            "migrations/001_init.sql",
            "node_modules/express/package.json",
            "package.json",
            "tsconfig.json",
            "docker-compose.yml",
            ".env.example",
            "SRC/app.ts"
        ]) {
            assert.equal(read(filePath), "allow", filePath);
        }
    });

    it("blocks the design notes, the skills, the private documents, the brief and the secrets", () => {
        for (const filePath of [
            "docs/project-guide.md",
            "DOCS/project-guide.md",
            "README.md",
            "CLAUDE.md",
            ".claude/skills/layered-express-service/SKILL.md",
            ".claude/hooks/auditor-read-scope.mjs",
            "RAG project/README.md",
            "RAG project/node_modules/x/index.js",
            "RAG API service \u2014 project brief.pdf",
            ".env",
            "dist/app.js",
            "src/../docs/project-guide.md",
            "../outside.txt",
            path.join(path.dirname(projectDir), "memory", "MEMORY.md")
        ]) {
            assert.equal(read(filePath), "deny", filePath);
        }
    });

    it("lets Grep and Glob search only inside an allowed path", () => {
        assert.equal(decide("Grep", { pattern: "SECRET", path: "src" }), "allow");
        assert.equal(decide("Grep", { pattern: "SECRET", path: "src", glob: "*.ts" }), "allow");
        assert.equal(decide("Glob", { pattern: "**/*.ts", path: "test" }), "allow");

        for (const [label, toolName, toolInput] of [
            ["Grep without a path searches the whole project", "Grep", { pattern: "SECRET" }],
            ["Grep at the project root", "Grep", { pattern: "SECRET", path: "." }],
            ["Grep in the design notes", "Grep", { pattern: "Decision", path: "docs" }],
            ["Grep in the private documents", "Grep", { pattern: "x", path: "RAG project" }],
            ["Grep with a glob that climbs out", "Grep", { pattern: "x", path: "src", glob: "../docs/*" }],
            ["Glob without a path", "Glob", { pattern: "**/*.md" }],
            ["Glob with a pattern that climbs out", "Glob", { pattern: "../**/*.md", path: "src" }],
            ["Glob with an absolute pattern", "Glob", { pattern: "D:/**/*.md", path: "src" }]
        ] as const) {
            assert.equal(decide(toolName, toolInput), "deny", label);
        }
    });

    it("lets the auditor hand its final report back", () => {
        assert.equal(decide("SubagentHandback", { message: "# Audit report" }), "allow");
    });

    it("denies every tool that writes, edits, runs commands or reaches the network, even on allowed paths", () => {
        for (const [toolName, toolInput] of [
            ["Write", { file_path: "src/app.ts", content: "" }],
            ["Edit", { file_path: "src/app.ts", old_string: "a", new_string: "b" }],
            ["NotebookEdit", { notebook_path: "test/x.ipynb", new_source: "" }],
            ["Bash", { command: "ls" }],
            ["PowerShell", { command: "Get-ChildItem" }],
            ["WebFetch", { url: "https://example.com" }],
            ["WebSearch", { query: "x" }],
            ["Agent", { prompt: "edit src/app.ts" }],
            ["subagenthandback", { message: "x" }]
        ] as const) {
            assert.equal(decide(toolName, toolInput), "deny", toolName);
        }
    });

    it("denies any call it cannot read", () => {
        assert.equal(decide("Read", {}, "not json"), "deny");
        assert.equal(decide("Read", {}), "deny");
    });
});

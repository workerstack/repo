// Host shells export project dirs; tests and the CLIs they spawn must resolve their own temp roots.
for (const key of ["CLAUDE_PROJECT_DIR", "GROK_WORKSPACE_ROOT", "GEMINI_PROJECT_DIR"]) delete process.env[key];

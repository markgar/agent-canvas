# Repository guidance

- Read `SPEC.md`, `README.md`, and `docs/architecture.md` before implementing a
  feature. Distinguish the current scaffold from proposed product capabilities.
- Keep this one modular TypeScript application. Do not introduce workspaces,
  infrastructure, persistence, or a frontend framework without a concrete need.
- Contracts in `src/contracts/` must remain usable without Node.js or browser
  globals. Infer wire types from runtime schemas.
- Server code may import contracts, never browser code. Browser code may import
  contracts, never server code. Keep transport details out of future domain logic.
- Never expose content endpoints before their authentication and rendering
  boundaries exist. Do not use real email in tests.
- Keep stdout clean for future stdio MCP; never log user content or credentials.
- Use `npm ci` to restore dependencies. Run targeted tests while iterating, then
  `npm run check` for changes that affect the repository scaffold.
- Preserve the committed lockfile. Do not introduce a second package manager.
- Update directly related documentation and tests with behavior changes.
- For feature specs, use `.github/skills/build-spec/SKILL.md`. Keep approval human:
  do not invent `approved_by`, mark a draft approved, or start a paid chain.
- Build policy lives in `.chainkit/governance/`; use the relevant stage's rules.
  `.chainkit/README.md` explains execution and the boundaries of enforcement.
- Never patch `vendor/chainkit/`. Workflow, governance, and quality-gate changes
  require a separate reviewed change, not a feature chain modifying its own rules.

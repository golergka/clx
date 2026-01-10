* Always use bun commands. Never run tsx or other tools directly.
* Commit regularly with conventional commits.
* When a spec is fully implemented and tested, update patch version. Never update minor/major without explicit user approval.
* Use `bun link` to link local binary for testing. Use `clx` command in terminal.  Never do: `node dist/index.js`
# clx Agent Testing Protocol

## Scenario

A tool called `clx` is installed on this system. You know nothing about it. Figure out what it does and how to use it by interacting with it directly.

**Do not:**
- Read source code
- Read external documentation
- Assume anything about how it works

**Do:**
- Explore via the CLI
- Note what's confusing or frustrating
- Create a GitHub issue for every friction point

**Keep in mind:** You are token-conscious. Verbose or unclear output wastes tokens.

---

## Tasks

Complete these in order. Document what you tried and what happened.

1. **Orientation** — Figure out what clx is and does.

2. **Find Stripe** — Your user wants to interact with Stripe's API. Can clx help?

3. **Set up Stripe** — Make Stripe commands available. User has key: `sk_test_abc123`

4. **List customers** — User says: "Show me our Stripe customers."

5. **Create a customer** — User says: "Add a customer with email test@example.com"

6. **Handle auth error** — What happens with an invalid API key?

7. **Try GitHub** — Set up GitHub API and list repositories.

8. **Discover parameters** — List only 5 customers with a specific email filter. Figure out the flags.

9. **Parse output** — Get customer list, extract just the IDs programmatically.

10. **Uninstall** — Remove GitHub.

11. **Break things** — Try invalid commands, bad flags, nonexistent endpoints. Are errors helpful?

---

## Issue Template

For each friction point:

```markdown
**Trying to:** [goal]
**Tried:** [commands]  
**Got:** [output/behavior]
**Expected:** [what would help]
**Impact:** [how this wastes tokens or blocks progress]
```
# AGENTS.md

Personal Hugo site (https://www.nathanmcoleman.com, PaperMod theme, deployed on Vercel) with two web games:

- **Venn**, a daily circle-turning puzzle at `/venn/`. Docs: `tools/venn/README.md`. Never edit a schedule or layout that has already been used; add a new schedule with a future `from` date (the tests fail otherwise). Tests: `npm run test:venn`.
- **Moon Rover**, an open-world Moon game at `/rover/`. Docs: `tools/rover/README.md`. Plain ES modules with no bundler; run `npm run rover:css` after Tailwind class changes.

Preview with `hugo server`.

## Project memory in the Obsidian vault

Every AI tool the owner uses shares one status file and session log for this project, kept in his Obsidian vault:

- Status: `C:\Users\natec\Desktop\markdown\Projects\Website - Venn and Moon Rover\STATUS.md`
- Log: `C:\Users\natec\Desktop\markdown\Projects\Website - Venn and Moon Rover\LOG.md`

**Start of a session:** if you can read those files, read STATUS.md and the last 3 LOG.md entries before starting.

**End of a session:** append one entry to the bottom of LOG.md in exactly this format (newest last). If you can't write to the vault, print the entry in a code block as your last message so the owner can paste it in.

```
## YYYY-MM-DD HH:MM · <model or agent name>
- Did: what was worked on
- Changed: files, settings or parts touched
- Decided: any decisions made (or "none")
- Next: the single most useful next step
```

Don't edit the text between the `AUTO-SUMMARY` markers in STATUS.md (a local summarizer rewrites it from LOG.md), and never delete LOG.md entries.

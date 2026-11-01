# Current work focus

On 2026-11-01 the user requested Designer feature/UI synchronization with the current main program and scoped fixes across all three editions. This is the Designer checkout; its source identity, project data root and CAD/design workflows remain distinct. The main development client is in D:/lumiOS. Native coordinate-driven acceptance remains paused. Historical lawyer acceptance is sealed under `archive/legal-development-20261027`; this maintenance does not resume its business operations or paid generations.

# Acceptance checkpoint workflow

This repository is part of the ongoing Lumi acceptance work.

- Before continuing, read `ACCEPTANCE.json` and its acceptance-record reference.
- Preserve user-confirmed results. Items 3, 15 and 16 are accepted and sealed; do not reopen them merely because an older evidence path is hard to find.
- Resume at the recorded item. Held or paused work stays held unless the user explicitly resumes it. Do not replay accepted business operations or paid generations.
- Preserve the configured default model unless the user authorizes a change.
- For each acceptance subcase, record the actual outcome and scope, including partial, failed or blocked outcomes. A test pass or an API subcase is not a whole-item acceptance.
- Seal immutable evidence with SHA-256, update the acceptance record and this checkpoint file, then make a local Git commit containing the related source, tests and checkpoint record. Do not leave an accepted step only in chat memory.
- Keep known failures and limitations explicit. A checkpoint commit is not a release or a claim that the whole application passed.
- Local commits and remote pushes are distinct; this workflow does not authorize an unrequested push.

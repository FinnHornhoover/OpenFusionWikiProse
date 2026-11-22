# OpenFusionWikiProse
Prose repository for the OpenFusionAutoWiki project.

Player-authored prose in `pages/` is licensed under
[Creative Commons Attribution-ShareAlike 3.0 Unported](LICENSE).
Image rights and credits are recorded separately where available.

## ZIP releases

The release workflow runs daily at **00:15 UTC**. To run it on demand, open
**Actions → Release player prose → Run workflow** on the default branch.

Each run checks for new prose, image attribution, or license changes on
`dev`. When changes are present, it merges `dev` into `main` locally,
packages the merged snapshot, and promotes it after the ZIP succeeds.
Runs skip when the branches have no new content to release.

Release titles use the UTC date, such as **Wiki prose 2026-11-23**.
Tags use `prose-2026-11-23` and ZIPs use
`openfusion-wiki-prose-2026-11-23.zip`. Additional releases on the same day
receive `-2`, `-3`, and subsequent suffixes, with the number in the release
title. An interrupted publication resumes its existing tagged snapshot
on the next run.

The workflow needs **Contents: Read and write** through its built-in
Actions token. Branch rules must allow the workflow to update `main`,
and tag rules must allow it to create `prose-*` tags. Keep the workflow
on the repository's default branch so scheduled runs are enabled.

The workflow runs this repository's exporter and publishes with its built-in
GitHub Actions token. It reads referenced images from `https://fusionfall.wiki`.
Set the Actions variable `FFWIKI_BASE_URL` here if this repository uses a
different wiki origin.

To generate a local ZIP with Node.js 22, run these commands from this repository.

```sh
npm ci --ignore-scripts
npm run export:prose -- --ref main --output /tmp/openfusion-wiki-prose.zip
```

The ZIP includes the committed prose, contributor credits, a CC BY-SA 3.0
notice, and local copies of the referenced images. The `manifest.json` file
maps image references to archive paths and records image attribution.
Downloads must resolve and match their content-addressed keys for the export
to succeed.

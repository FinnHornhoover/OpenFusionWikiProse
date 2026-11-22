# OpenFusionWikiProse
Prose repository for the OpenFusionAutoWiki project.

Player-authored prose in `pages/` is licensed under
[Creative Commons Attribution-ShareAlike 3.0 Unported](LICENSE).
Image rights and credits are recorded separately where available.

## ZIP releases

Merge `dev` into `main` to approve a release snapshot, then open
**Actions → Release player prose → Run workflow**. The workflow packages
`pages/` from the selected `main` commit and attaches the ZIP to its tag
under **Releases**.
Full OpenFusionAutoWiki deploys also request a release here.

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

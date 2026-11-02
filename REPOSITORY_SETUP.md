# GitHub Desktop setup

The public upstream is https://github.com/mullojo/simple-gift-sharer.

To work on the existing repository, use **File → Clone Repository → URL** in
GitHub Desktop and paste that URL. If this folder is already connected to the
upstream, continue using it and skip the creation/publishing steps below.
Contributors can fork the repository on GitHub and clone their fork in Desktop.

The following steps are for creating a separate repository from a source copy
that does not already have Git history. Git initialization, commits, GitHub
publication and settings are handled by the maintainer in GitHub Desktop.

## Create the local repository

1. In GitHub Desktop, choose **File → New Repository**.
2. Set **Name** to `simple-gift-sharer`.
3. Set **Local path** to the parent directory that already contains this folder
   (`Components` in this workspace). The resulting full path must point at the
   existing `Components/simple-gift-sharer`, with no second nested folder.
4. Leave **Initialize this repository with a README** unchecked. Choose **None**
   for the generated Git ignore and License options: `.gitignore`, `README.md`
   and the MIT `LICENSE` have already been prepared here.
5. Create the repository. Desktop normally creates its initial commit; review
   the files/history and commit any remaining prepared changes if needed.

Suggested description:

> No-build, local-first Bitcoin gift sharing with temporary browser purses.

Suggested commit summary if Desktop asks for one:

> Prepare simple-gift-sharer for an MIT open-source release

Before publishing, review the file list. Only this component belongs in the repo,
not sibling Purse projects. Do not include recovery exports, recipient-key JSON,
browser profiles or local data. `.gitignore` covers the app's export filenames,
including numbered recipient-key downloads, and designated local-data folders;
it cannot identify a secret file that has been renamed arbitrarily. Keep all real
backups outside the checkout. No `.git` directory is included in the prepared files.

## Publish

1. Click **Publish repository**.
2. Keep the name `simple-gift-sharer`, select your personal account or organization,
   and **uncheck “Keep this code private”** to publish publicly.
3. Click **Publish repository**, then **View on GitHub**.
4. Confirm the README and MIT license display, and that the **Checks** workflow
   passes on the published commit. Tests need no repository secrets or funds.

`private: true` in `package.json` prevents npm publishing, not GitHub publication.
No GitHub Pages site or npm package is published by this setup.

## Repository settings on GitHub

- Enable **Private vulnerability reporting** in the repository's security settings
  if available, so the private reporting path described in SECURITY.md is usable.
- Suggested topics: `bitcoin`, `testnet4`, `local-first`, `vue3`, `no-build`,
  `gift-sharing`.
- Optionally enable branch protection/rulesets for your default branch and require
  the Checks workflow when collaborating with others.

## Later changes

Review changes in GitHub Desktop, commit locally, then **Push origin**. Keep
recovery and recipient-key files outside Git. Use Testnet4 for reproduction and
include the test results in pull requests.

GitHub's own walkthrough:
https://docs.github.com/en/desktop/overview/creating-your-first-repository-using-github-desktop

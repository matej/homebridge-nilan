# Releasing

Publishing is automated from GitHub Releases through npm trusted publishing.
The workflow uses short-lived OpenID Connect credentials and does not require an
`NPM_TOKEN` repository secret.

## One-time npm setup

Configure `homebridge-nilan` on npm with this trusted publisher:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `matej` |
| Repository | `homebridge-nilan` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | `npm publish` |

This can be configured under the package's trusted-publisher settings on
npmjs.com or with npm 11.15.0 or newer while authenticated with two-factor
authentication:

```sh
npm trust github homebridge-nilan \
  --file release.yml \
  --repo matej/homebridge-nilan \
  --env npm \
  --allow-publish \
  --yes
```

After the first successful trusted publish, disable token-based publishing and
revoke any obsolete npm automation tokens.

## Release process

1. Check `npm view homebridge-nilan version`, then update `version` in both
   `package.json` and `package-lock.json` to a strictly newer version in a pull
   request and document user-visible changes.
2. Merge the pull request after all required checks pass.
3. Create and publish a GitHub Release from `master` using the exact tag
   `v<package-version>`, for example `v2.0.0`.
4. Monitor the **Release** workflow. It validates the tag and commit, runs the
   complete test suite, inspects the npm tarball, and publishes it with
   provenance.
5. Confirm the new version on npm, review its distribution tags, and install it
   in a test Homebridge instance. Remove obsolete distribution tags only after
   the replacement release is verified.

Stable GitHub Releases publish with the npm `latest` distribution tag. GitHub
pre-releases publish with the `next` tag.
